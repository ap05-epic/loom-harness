import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LlmGateway } from '@loom/agents';
import {
  applyGateDecision,
  GateStore,
  MIGRATIONS,
  openDb,
  runMigrations,
  TaskStore,
} from '@loom/core';
import type { DomSnapshot } from '@loom/browser';
import { PNG } from 'pngjs';
import { expect, test } from 'vitest';
import type { BuildStrategy } from './builder.js';
import {
  runBuildStage,
  runCrawlStage,
  runMapStage,
  runPlanStage,
  type CaptureFn,
  type DomCaptureFn,
  type RunPipelineOptions,
} from './pipeline.js';

const STRUTS_CONFIG = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
  'WEB-INF',
  'struts-config.xml',
);

const tmp = (): string => mkdtempSync(join(tmpdir(), 'pipeline-stages-'));

function harnessDb() {
  const db = openDb(join(tmp(), 'harness.db'));
  runMigrations(db, MIGRATIONS);
  return db;
}

function solidPng(rgb: [number, number, number]): Buffer {
  const p = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < 4 * 4; i++) {
    const o = i * 4;
    p.data[o] = rgb[0];
    p.data[o + 1] = rgb[1];
    p.data[o + 2] = rgb[2];
    p.data[o + 3] = 255;
  }
  return PNG.sync.write(p);
}
const same = solidPng([240, 240, 240]);
const fakeCapture: CaptureFn = () => Promise.resolve(same);
const matchingDom: DomSnapshot = { tag: 'body', attrs: {}, children: [] };
const fakeDomCapture: DomCaptureFn = () => Promise.resolve(matchingDom);

/** A build seam that writes a file, reports success, and "spends" the given tokens. */
function spendingBuild(tokens: number): BuildStrategy {
  return async ({ bRepoDir }) => {
    writeFileSync(join(bRepoDir, 'index.html'), '<body></body>');
    return {
      status: 'completed',
      filesWritten: ['index.html'],
      usage: { inputTokens: tokens, outputTokens: 0 },
    };
  };
}

const baseOptions = (db: ReturnType<typeof harnessDb>): RunPipelineOptions => ({
  db,
  gateway: { complete: () => Promise.reject(new Error('unused')) } as LlmGateway,
  model: 'mock',
  project: 'fixture',
  strutsConfigPath: STRUTS_CONFIG,
  atlasPath: join(tmp(), 'codeatlas.db'),
  legacyBaseUrl: 'http://legacy.test/',
  bRepoRoot: tmp(),
  capture: fakeCapture,
  domCapture: fakeDomCapture,
  build: spendingBuild(1),
});

test('the discrete stages compose: map → plan → crawl → build passes the screen', async () => {
  const db = harnessDb();
  const opts = { ...baseOptions(db), screens: ['login'] };
  const tasks = new TaskStore(db);

  // MAP — creates the run, emits map.completed, sets stage, but plans nothing and does NOT finish.
  const m = await runMapStage(opts);
  const runId = m.runId;
  expect(tasks.getRun(runId)?.stage).toBe('map');
  expect(tasks.listWorkPackages(runId)).toHaveLength(0);
  expect(tasks.getRun(runId)?.status).toBe('running');

  // PLAN — creates one work package, still does NOT finish the run.
  await runPlanStage({ ...opts, runId });
  const wps = tasks.listWorkPackages(runId);
  expect(wps).toHaveLength(1);
  expect(wps[0]?.state).toBe('planned');
  expect(tasks.getRun(runId)?.status).toBe('running');

  // PLAN opens a plan gate — approve it (the human-in-the-loop) before BUILD will run.
  const planGate = new GateStore(db).list({ status: 'open' }).find((g) => g.type === 'plan');
  expect(planGate).toBeDefined();
  applyGateDecision(db, planGate!.id, 'approved');

  // CRAWL — captures the baseline; BUILD — builds, evaluates, passes, and finishes the run.
  await runCrawlStage({ ...opts, runId });
  const b = await runBuildStage({ ...opts, runId });
  expect(b.passed).toBe(1);
  expect(tasks.getRun(runId)?.status).toBe('completed');
});

test('a discrete build waits for the plan gate to be approved', async () => {
  const db = harnessDb();
  const opts = { ...baseOptions(db), screens: ['login'] };
  const tasks = new TaskStore(db);
  await runMapStage(opts);
  const runId = tasks.latestRun()!.id;
  await runPlanStage({ ...opts, runId });
  await runCrawlStage({ ...opts, runId });

  // The plan gate is open → BUILD does nothing and the run stays open.
  const blocked = await runBuildStage({ ...opts, runId });
  expect(blocked.passed).toBe(0);
  expect(tasks.getRun(runId)?.status).toBe('running');

  // Approve the plan gate → BUILD now runs and finishes the run.
  const gate = new GateStore(db).list({ status: 'open' }).find((g) => g.type === 'plan')!;
  applyGateDecision(db, gate.id, 'approved');
  const built = await runBuildStage({ ...opts, runId });
  expect(built.passed).toBe(1);
  expect(tasks.getRun(runId)?.status).toBe('completed');
});

test('a resumed build seeds the shift token budget from prior spend (no overspend)', async () => {
  const db = harnessDb();
  // Two screens; each build "spends" 5 tokens. A token budget of 5 stops after the first screen.
  const opts = { ...baseOptions(db), screens: ['login', 'list'], build: spendingBuild(5) };
  const tasks = new TaskStore(db);

  await runMapStage(opts);
  const runId = tasks.latestRun()!.id;
  await runPlanStage({ ...opts, runId });
  applyGateDecision(
    db,
    new GateStore(db).list({ status: 'open' }).find((g) => g.type === 'plan')!.id,
    'approved',
  );
  await runCrawlStage({ ...opts, runId });

  // First build segment: budget 5 → the first screen builds (spends 5), then the guard stops the run
  // before the second screen.
  const first = await runBuildStage({ ...opts, runId, shift: { maxTokens: 5 } });
  expect(first.stopReason).toBe('budget_tokens');
  const builtFirst = first.screens.filter((s) => s.state === 'passed').length;
  expect(builtFirst).toBe(1);
  const remaining = first.screens.filter((s) => s.state === 'planned').length;
  expect(remaining).toBe(1); // the second screen was not built

  // Resume with the SAME budget: the cumulative spend (5) is seeded from the prior attempt, so the
  // guard trips immediately and the second screen is NOT built. Without the fix it would reset to 0
  // and overspend by building the second screen.
  const resumed = await runBuildStage({ ...opts, runId, shift: { maxTokens: 5 } });
  expect(resumed.stopReason).toBe('budget_tokens');
  expect(resumed.screens.filter((s) => s.state === 'passed').length).toBe(1); // still just one
  expect(resumed.screens.filter((s) => s.state === 'planned').length).toBe(1); // second still unbuilt
});
