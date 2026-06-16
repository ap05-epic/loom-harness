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
import { dashboardState, wpDetail } from './read-model.js';

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
  tasks.recordEval({
    wpId: passed.id,
    attemptId: att.id,
    scorecard: {},
    visualPct: 0.4,
    passed: true,
  });
  const building = tasks.createWorkPackage({
    runId: run.id,
    title: 'list',
    screenKey: 'list',
    spec: {},
  });
  tasks.setWorkPackageState(building.id, 'building');
  const batt = tasks.createAttempt({
    wpId: building.id,
    role: 'builder',
    model: 'gpt-5.4',
    pid: 2,
  });
  tasks.finishAttempt(batt.id, { status: 'failed', failureReason: 'visual diff 3.10%' });
  new EventLog(db).append({
    type: 'attempt.started',
    runId: run.id,
    wpId: building.id,
    payload: {},
  });
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
    // Live Now: only the active (building) worker, with its attempt # + last activity
    expect(state.liveNow).toHaveLength(1);
    expect(state.liveNow[0]).toMatchObject({
      screenKey: 'list',
      state: 'building',
      attempt: 1,
      lastEvent: 'attempt.started',
    });
    expect(state.gates).toHaveLength(1);
    expect(state.gates[0]!.type).toBe('ship');
    expect(state.questions).toHaveLength(1);
    expect(state.cost.inputTokens).toBe(40);
    expect(state.cost.outputTokens).toBe(12);
    // cost-by-model comes from the attempt rollup (gpt-5.4: 800+200 tokens over 2 attempts)
    expect(state.costByModel).toEqual([{ model: 'gpt-5.4', tokens: 1000, attempts: 2 }]);
    // eval analytics: 1 evaluated screen passed; the failed attempt categorizes as "visual diff"
    expect(state.evalAnalytics.evaluated).toBe(1);
    expect(state.evalAnalytics.passed).toBe(1);
    expect(state.evalAnalytics.passRate).toBe(1);
    expect(state.evalAnalytics.failureReasons).toEqual([{ reason: 'visual diff', count: 1 }]);
    expect(state.recent.map((e) => e.type)).toContain('wp.passed');
  });

  test('defaults to the latest run and degrades to null when there is none', () => {
    expect(dashboardState(db).run).toBeNull();
    const runId = seed();
    expect(dashboardState(db).run?.id).toBe(runId); // no runId → latest
  });

  test("wpDetail returns a work package's attempt timeline + best eval", () => {
    const tasks = new TaskStore(db);
    const run = tasks.createRun({ project: 'fixture' });
    const wp = tasks.createWorkPackage({
      runId: run.id,
      title: 'login',
      screenKey: 'login',
      spec: {},
    });
    const a1 = tasks.createAttempt({ wpId: wp.id, role: 'builder', model: 'm', pid: 1 });
    tasks.finishAttempt(a1.id, { status: 'failed', failureReason: 'visual diff 3%' });
    const a2 = tasks.createAttempt({ wpId: wp.id, role: 'builder', model: 'm', pid: 2 });
    tasks.finishAttempt(a2.id, { status: 'passed', inputTokens: 500, outputTokens: 100 });
    tasks.recordEval({
      wpId: wp.id,
      attemptId: a2.id,
      scorecard: {},
      visualPct: 0.5,
      passed: true,
    });

    const d = wpDetail(db, wp.id)!;
    expect(d.screenKey).toBe('login');
    expect(d.attempts).toHaveLength(2);
    expect(d.attempts[0]!.failureReason).toContain('visual diff');
    expect(d.attempts[1]!.status).toBe('passed');
    expect(d.bestEval).toEqual({ visualPct: 0.5, passed: true });
    expect(wpDetail(db, 'nope')).toBeNull();
  });
});
