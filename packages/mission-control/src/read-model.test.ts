import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EventLog,
  GateStore,
  MIGRATIONS,
  openDb,
  QuestionStore,
  runMigrations,
  SpanStore,
  TaskStore,
  type SqliteDatabase,
} from '@loom/core';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { dashboardState } from './read-model.js';

let dir: string;
let db: SqliteDatabase;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-read-'));
  db = openDb(join(dir, 'loom.db'));
  runMigrations(db, MIGRATIONS);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Seed a run: one passed + one building screen, an open ship gate, a question, a span, events. */
function seed(): string {
  const tasks = new TaskStore(db);
  const run = tasks.createRun({ project: 'fixture', harnessVersion: '1.0.0' });
  tasks.setRunStage(run.id, 'build');
  const passed = tasks.createWorkPackage({
    runId: run.id,
    title: 'login',
    screenKey: 'login',
    spec: {},
  });
  tasks.setWorkPackageState(passed.id, 'passed');
  const att = tasks.createAttempt({ wpId: passed.id, role: 'builder', model: 'gpt-5.4', pid: 1 });
  tasks.finishAttempt(att.id, { status: 'passed', inputTokens: 800, outputTokens: 200 });
  const building = tasks.createWorkPackage({
    runId: run.id,
    title: 'list',
    screenKey: 'list',
    spec: {},
  });
  tasks.setWorkPackageState(building.id, 'building');
  new GateStore(db).open({
    scopeType: 'wp',
    scopeId: passed.id,
    type: 'ship',
    payload: { screenKey: 'login' },
  });
  new QuestionStore(db).ask({ runId: run.id, wpId: building.id, question: 'How to proceed?' });
  new SpanStore(db).record({
    traceId: run.id,
    runId: run.id,
    name: 'build.attempt',
    kind: 'llm',
    durationMs: 100,
    attributes: { 'gen_ai.usage.input_tokens': 40, 'gen_ai.usage.output_tokens': 12 },
  });
  new EventLog(db).append({ type: 'wp.passed', runId: run.id, wpId: passed.id, payload: {} });
  return run.id;
}

describe('dashboardState', () => {
  test('assembles the full Mission Control state for a run', () => {
    const runId = seed();
    const state = dashboardState(db, runId);

    expect(state.run?.id).toBe(runId);
    expect(state.run?.stage).toBe('build');
    expect(state.screens).toHaveLength(2);
    expect(state.counts.passed).toBe(1);
    expect(state.counts.building).toBe(1);
    expect(state.gates).toHaveLength(1);
    expect(state.gates[0]!.type).toBe('ship');
    expect(state.questions).toHaveLength(1);
    expect(state.cost.inputTokens).toBe(40);
    expect(state.cost.outputTokens).toBe(12);
    // cost-by-model comes from the attempt rollup (gpt-5.4: 800+200 tokens)
    expect(state.costByModel).toEqual([{ model: 'gpt-5.4', tokens: 1000, attempts: 1 }]);
    expect(state.recent.map((e) => e.type)).toContain('wp.passed');
  });

  test('defaults to the latest run and degrades to null when there is none', () => {
    expect(dashboardState(db).run).toBeNull();
    const runId = seed();
    expect(dashboardState(db).run?.id).toBe(runId); // no runId → latest
  });
});
