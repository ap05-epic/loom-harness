import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  MIGRATIONS,
  openDb,
  QuestionStore,
  runMigrations,
  TaskStore,
  type SqliteDatabase,
} from '@loom/core';
import { buildRunReport } from './report.js';

let dir: string;
let db: SqliteDatabase;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'report-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('buildRunReport', () => {
  test('renders screens, coverage, spend, and the open inbox as markdown', () => {
    const store = new TaskStore(db);
    const run = store.createRun({ project: 'fixture' });
    const wp1 = store.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Login' });
    const wp2 = store.createWorkPackage({ runId: run.id, screenKey: 'list', title: 'List' });
    store.setWorkPackageState(wp1.id, 'passed');
    store.setWorkPackageState(wp2.id, 'blocked');
    const a = store.createAttempt({ wpId: wp1.id, role: 'builder', model: 'gpt-x' });
    store.finishAttempt(a.id, { status: 'passed', inputTokens: 100, outputTokens: 40 });
    store.recordEval({
      wpId: wp1.id,
      attemptId: a.id,
      visualPct: 0.4,
      passed: true,
      scorecard: {},
    });
    new QuestionStore(db).ask({ runId: run.id, wpId: wp2.id, question: 'how to proceed?' });

    const md = buildRunReport(db, run.id);
    expect(md).toContain('# Modernization report');
    expect(md).toContain('fixture');
    expect(md).toContain('login');
    expect(md).toContain('passed');
    expect(md).toContain('0.40%'); // best diff for the passed screen
    expect(md).toMatch(/1 \/ 2/); // coverage: 1 of 2 screens
    expect(md).toContain('140'); // total tokens (100 + 40)
    expect(md).toContain('1 open question');
  });

  test('an empty run reports 0/0 coverage without dividing by zero', () => {
    const store = new TaskStore(db);
    const run = store.createRun({ project: 'fixture' });
    const md = buildRunReport(db, run.id);
    expect(md).toContain('0 / 0');
    expect(md).toContain('0%');
  });
});
