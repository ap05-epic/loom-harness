import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations } from '../db/db.js';
import { MIGRATIONS } from '../db/migrations.js';
import { QuestionStore } from './questions.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

let dir: string;
let db: SqliteDatabase;
let store: QuestionStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'questions-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
  store = new QuestionStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('QuestionStore', () => {
  test('asks a question and reads it back with its context', () => {
    const q = store.ask({
      runId: 'run_1',
      wpId: 'wp_1',
      question: 'Which date format should the grid use?',
      context: { screen: 'deal-list', tried: ['dd.MM.yyyy'] },
    });
    expect(q.id).toMatch(/^q_/);
    expect(q.status).toBe('open');
    const got = store.get(q.id)!;
    expect(got.question).toContain('date format');
    expect(got.context).toEqual({ screen: 'deal-list', tried: ['dd.MM.yyyy'] });
    expect(got.answer).toBeNull();
  });

  test('lists open questions, filterable by wp (the inbox)', () => {
    store.ask({ wpId: 'wp_1', question: 'a?' });
    store.ask({ wpId: 'wp_2', question: 'b?' });
    expect(store.list({ status: 'open' })).toHaveLength(2);
    expect(store.list({ status: 'open', wpId: 'wp_1' }).map((q) => q.question)).toEqual(['a?']);
  });

  test('answering records the answer and closes the question', () => {
    const q = store.ask({ wpId: 'wp_1', question: 'a?' });
    const answered = store.answer(q.id, 'use dd.MM.yyyy');
    expect(answered.status).toBe('answered');
    expect(answered.answer).toBe('use dd.MM.yyyy');
    expect(store.list({ status: 'open' })).toHaveLength(0);
    expect(store.list({ status: 'answered' })).toHaveLength(1);
  });
});
