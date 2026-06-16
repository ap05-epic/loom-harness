import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAiDriver } from '@loom/agents';
import { canLaunchBrowser } from '@loom/browser';
import { MIGRATIONS, openDb, runMigrations, TaskStore } from '@loom/core';
import { canRunJava, LegacyFixture, MockLlmServer } from '@loom/test-kit';
import { afterAll, expect, test } from 'vitest';
import { runPipeline } from './pipeline.js';

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

// The real walking skeleton needs both a JDK (to run the legacy fixture) and a
// launchable browser (to capture A/B). Self-skips in CI environments lacking
// either; runs for real on the dev box and the pod.
const javaOk = canRunJava();
const browserOk = await canLaunchBrowser();
const liveOk = javaOk && browserOk;

let fixture: LegacyFixture | undefined;
let mock: MockLlmServer | undefined;
afterAll(async () => {
  await fixture?.stop();
  await mock?.stop();
});

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test.runIf(liveOk)(
  'walking skeleton: fixture login goes MAP → build → eval → passed with a real browser',
  async () => {
    fixture = new LegacyFixture({ port: 8142 });
    const baseUrl = await fixture.start();

    // Deterministic stand-in for the model: hand the Builder the exact legacy
    // markup so what's under test is the pipeline machinery (map → build →
    // serve → capture → diff → state), not the model's conversion skill. The
    // real agent earns parity on the pod; the anti-cheat evaluator layers (M5)
    // guard that path. A faithful rebuild must render identically to A.
    const html = await (await fetch(`${baseUrl}login`)).text();
    const css = await (await fetch(`${baseUrl}style.css`)).text();

    mock = new MockLlmServer();
    const { baseUrl: llmUrl } = await mock.start();
    mock.enqueueToolCall('write_file', { path: 'index.html', content: html });
    mock.enqueueToolCall('write_file', { path: 'style.css', content: css });
    mock.enqueueText('Rebuilt the login screen.');

    const db = openDb(join(tmp('e2e-db-'), 'harness.db'));
    runMigrations(db, MIGRATIONS);

    const result = await runPipeline({
      db,
      gateway: new OpenAiDriver({ baseUrl: llmUrl, apiKey: 'test' }),
      model: 'mock',
      project: 'fixture',
      strutsConfigPath: STRUTS_CONFIG,
      atlasPath: join(tmp('e2e-atlas-'), 'codeatlas.db'),
      legacyBaseUrl: baseUrl,
      bRepoRoot: tmp('e2e-brepo-'),
      screens: ['login'],
      threshold: 2,
    });

    expect(result.screens).toHaveLength(1);
    expect(result.screens[0].screenKey).toBe('login');
    expect(result.screens[0].state).toBe('passed');
    expect(result.screens[0].diffPercent).not.toBeNull();
    expect(result.screens[0].diffPercent!).toBeLessThanOrEqual(2);

    const store = new TaskStore(db);
    expect(store.getRun(result.runId)?.status).toBe('completed');
    const wp = store.listWorkPackages(result.runId)[0];
    expect(store.bestEval(wp.id)?.passed).toBe(true);
  },
  60_000,
);
