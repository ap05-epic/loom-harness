import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations } from '../db/db.js';
import { MIGRATIONS } from '../db/migrations.js';
import { TaskStore } from './tasks.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

let dir: string;
let db: SqliteDatabase;
let store: TaskStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tasks-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
  store = new TaskStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('TaskStore — runs & work packages', () => {
  test('creates a run and advances its stage', () => {
    const run = store.createRun({ project: 'fixture', harnessVersion: '0.1.0' });
    expect(run.status).toBe('running');
    expect(run.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp, finishedAt null until done
    expect(run.finishedAt).toBeNull();
    store.setRunStage(run.id, 'map');
    expect(store.getRun(run.id)!.stage).toBe('map');
    store.finishRun(run.id, 'completed');
    const done = store.getRun(run.id)!;
    expect(done.status).toBe('completed');
    expect(done.finishedAt).not.toBeNull();
  });

  test('creates work packages and transitions their state', () => {
    const run = store.createRun({ project: 'fixture' });
    const wp = store.createWorkPackage({
      runId: run.id,
      screenKey: 'login',
      title: 'Login screen',
      spec: { actionPath: '/login' },
    });
    expect(wp.state).toBe('pending');
    store.setWorkPackageState(wp.id, 'building');
    expect(store.getWorkPackage(wp.id)!.state).toBe('building');
    expect(store.listWorkPackages(run.id, { state: 'building' })).toHaveLength(1);
    expect(store.getWorkPackage(wp.id)!.spec).toEqual({ actionPath: '/login' });
  });
});

describe('TaskStore — attempts & evals', () => {
  test('numbers attempts per work package and records completion', () => {
    const run = store.createRun({ project: 'fixture' });
    const wp = store.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Login' });
    const a1 = store.createAttempt({ wpId: wp.id, role: 'builder', pid: 1234 });
    const a2 = store.createAttempt({ wpId: wp.id, role: 'fixer' });
    expect(a1.n).toBe(1);
    expect(a2.n).toBe(2);
    store.finishAttempt(a1.id, {
      status: 'failed',
      inputTokens: 100,
      outputTokens: 50,
      failureReason: 'eval failed',
    });
    const done = store.getAttempt(a1.id)!;
    expect(done.status).toBe('failed');
    expect(done.inputTokens).toBe(100);
  });

  test('records evals and tracks the best (lowest visual diff)', () => {
    const run = store.createRun({ project: 'fixture' });
    const wp = store.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Login' });
    const a1 = store.createAttempt({ wpId: wp.id, role: 'builder' });
    const a2 = store.createAttempt({ wpId: wp.id, role: 'fixer' });
    store.recordEval({ wpId: wp.id, attemptId: a1.id, visualPct: 8, passed: false, scorecard: {} });
    store.recordEval({
      wpId: wp.id,
      attemptId: a2.id,
      visualPct: 0.5,
      passed: true,
      scorecard: {},
    });
    expect(store.bestEval(wp.id)!.attemptId).toBe(a2.id);
    expect(store.bestEval(wp.id)!.passed).toBe(true);
  });

  test('eval-regression: a worse later attempt does not become best', () => {
    const run = store.createRun({ project: 'fixture' });
    const wp = store.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Login' });
    const a1 = store.createAttempt({ wpId: wp.id, role: 'builder' });
    const a2 = store.createAttempt({ wpId: wp.id, role: 'fixer' });
    store.recordEval({ wpId: wp.id, attemptId: a1.id, visualPct: 1, passed: true, scorecard: {} });
    store.recordEval({ wpId: wp.id, attemptId: a2.id, visualPct: 9, passed: false, scorecard: {} });
    expect(store.bestEval(wp.id)!.attemptId).toBe(a1.id);
  });
});

describe('TaskStore — crash resume', () => {
  test('reconcileInterrupted marks running attempts as interrupted', () => {
    const run = store.createRun({ project: 'fixture' });
    const wp = store.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Login' });
    store.createAttempt({ wpId: wp.id, role: 'builder', pid: 999 }); // left 'running' (process died)
    const count = store.reconcileInterrupted();
    expect(count).toBe(1);
    expect(store.listAttempts(wp.id)[0]!.status).toBe('interrupted');
  });
});

describe('TaskStore — latestRun', () => {
  test('returns the most recently created run', () => {
    store.createRun({ project: 'a' });
    const second = store.createRun({ project: 'b' });
    expect(store.latestRun()?.id).toBe(second.id);
  });

  test('filters by status to find a resumable (running) run', () => {
    const first = store.createRun({ project: 'a' });
    const second = store.createRun({ project: 'b' });
    store.finishRun(second.id, 'completed');
    expect(store.latestRun({ status: 'running' })?.id).toBe(first.id);
  });

  test('returns null when no run matches', () => {
    expect(store.latestRun()).toBeNull();
    const run = store.createRun({ project: 'a' });
    store.finishRun(run.id, 'completed');
    expect(store.latestRun({ status: 'running' })).toBeNull();
  });
});

describe('TaskStore — usage rollup', () => {
  test('rolls up attempt tokens for a run, broken down by role and model', () => {
    const run = store.createRun({ project: 'fixture' });
    const wp1 = store.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Login' });
    const wp2 = store.createWorkPackage({ runId: run.id, screenKey: 'list', title: 'List' });
    const a1 = store.createAttempt({ wpId: wp1.id, role: 'builder', model: 'gpt-x' });
    const a2 = store.createAttempt({ wpId: wp1.id, role: 'fixer', model: 'gpt-x' });
    const a3 = store.createAttempt({ wpId: wp2.id, role: 'builder', model: 'gpt-mini' });
    store.finishAttempt(a1.id, { status: 'failed', inputTokens: 100, outputTokens: 50 });
    store.finishAttempt(a2.id, { status: 'passed', inputTokens: 200, outputTokens: 80 });
    store.finishAttempt(a3.id, { status: 'passed', inputTokens: 30, outputTokens: 10 });

    const r = store.usageRollup(run.id);
    expect(r).toMatchObject({ inputTokens: 330, outputTokens: 140, attempts: 3 });
    expect(r.byRole.find((x) => x.role === 'builder')).toMatchObject({
      inputTokens: 130,
      outputTokens: 60,
      attempts: 2,
    });
    expect(r.byRole.find((x) => x.role === 'fixer')).toMatchObject({
      inputTokens: 200,
      attempts: 1,
    });
    expect(r.byModel.find((x) => x.model === 'gpt-x')).toMatchObject({
      inputTokens: 300,
      outputTokens: 130,
    });
  });

  test('a run with no attempts rolls up to zero', () => {
    const run = store.createRun({ project: 'fixture' });
    const r = store.usageRollup(run.id);
    expect(r).toMatchObject({ inputTokens: 0, outputTokens: 0, attempts: 0 });
    expect(r.byRole).toEqual([]);
    expect(r.byModel).toEqual([]);
  });
});
