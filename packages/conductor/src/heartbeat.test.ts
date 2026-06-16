import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  EventLog,
  GateStore,
  MIGRATIONS,
  openDb,
  QuestionStore,
  runMigrations,
  TaskStore,
  type SqliteDatabase,
} from '@loom/core';
import { heartbeat, emitHeartbeat } from './heartbeat.js';

let dir: string;
let db: SqliteDatabase;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'heartbeat-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function seededRun(): string {
  const store = new TaskStore(db);
  const run = store.createRun({ project: 'fixture' });
  store.setRunStage(run.id, 'build');
  const wp1 = store.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Login' });
  const wp2 = store.createWorkPackage({ runId: run.id, screenKey: 'list', title: 'List' });
  const wp3 = store.createWorkPackage({ runId: run.id, screenKey: 'popup', title: 'Popup' });
  store.setWorkPackageState(wp1.id, 'passed');
  store.setWorkPackageState(wp2.id, 'building');
  store.setWorkPackageState(wp3.id, 'blocked');
  const a = store.createAttempt({ wpId: wp1.id, role: 'builder', model: 'gpt-x' });
  store.finishAttempt(a.id, { status: 'passed', inputTokens: 120, outputTokens: 40 });
  new GateStore(db).open({ scopeType: 'skill', scopeId: 'skill_1', type: 'skill' });
  new QuestionStore(db).ask({ runId: run.id, wpId: wp3.id, question: 'how to proceed?' });
  return run.id;
}

describe('heartbeat', () => {
  test('snapshots WP states, token usage, and open inbox counts', () => {
    const runId = seededRun();
    const hb = heartbeat(db, runId);
    expect(hb.runId).toBe(runId);
    expect(hb.stage).toBe('build');
    expect(hb.wpByState).toMatchObject({ passed: 1, building: 1, blocked: 1 });
    expect(hb.inputTokens).toBe(120);
    expect(hb.outputTokens).toBe(40);
    expect(hb.attempts).toBe(1);
    expect(hb.openGates).toBeGreaterThanOrEqual(1);
    expect(hb.openQuestions).toBe(1);
  });

  test('emitHeartbeat writes a heartbeat event for watchers to tail', () => {
    const runId = seededRun();
    const hb = emitHeartbeat(db, runId);
    const events = new EventLog(db).tailFrom(0, 100, { runId });
    const beat = events.find((e) => e.type === 'heartbeat');
    expect(beat).toBeDefined();
    expect((beat!.payload as { openQuestions: number }).openQuestions).toBe(hb.openQuestions);
  });
});
