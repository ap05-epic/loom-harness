import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations } from '../db/db.js';
import { MIGRATIONS } from '../db/migrations.js';
import { EventLog } from './events.js';
import type Database from 'better-sqlite3';

let dir: string;
let db: Database.Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-events-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('EventLog', () => {
  test('append returns the stored event with a monotonic numeric id and timestamp', () => {
    const log = new EventLog(db);
    const a = log.append({ type: 'run.started', payload: { stage: 'map' } });
    const b = log.append({ type: 'run.finished', payload: {} });
    expect(a.id).toBeGreaterThan(0);
    expect(b.id).toBeGreaterThan(a.id);
    expect(a.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(a.type).toBe('run.started');
    expect(a.payload).toEqual({ stage: 'map' });
  });

  test('tailFrom returns only events after the cursor, in order', () => {
    const log = new EventLog(db);
    const first = log.append({ type: 'one', payload: {} });
    log.append({ type: 'two', payload: {} });
    log.append({ type: 'three', payload: {} });

    const tail = log.tailFrom(first.id);
    expect(tail.map((e) => e.type)).toEqual(['two', 'three']);
  });

  test('tailFrom(0) returns everything and respects the limit', () => {
    const log = new EventLog(db);
    for (let i = 0; i < 10; i++) log.append({ type: `e${i}`, payload: {} });
    expect(log.tailFrom(0)).toHaveLength(10);
    expect(log.tailFrom(0, 3).map((e) => e.type)).toEqual(['e0', 'e1', 'e2']);
  });

  test('correlation ids (runId, wpId, attemptId) are stored and queryable', () => {
    const log = new EventLog(db);
    log.append({ type: 'a', payload: {}, runId: 'run_1', wpId: 'wp_1' });
    log.append({ type: 'b', payload: {}, runId: 'run_1', wpId: 'wp_2', attemptId: 'att_1' });
    log.append({ type: 'c', payload: {}, runId: 'run_2' });

    const forRun = log.tailFrom(0, 100, { runId: 'run_1' });
    expect(forRun.map((e) => e.type)).toEqual(['a', 'b']);
    const forWp = log.tailFrom(0, 100, { wpId: 'wp_2' });
    expect(forWp.map((e) => e.type)).toEqual(['b']);
    expect(forWp[0]?.attemptId).toBe('att_1');
  });

  test('payloads survive JSON round-trips with nested structures', () => {
    const log = new EventLog(db);
    const payload = { nested: { list: [1, 'two', { three: true }] }, n: null };
    const e = log.append({ type: 'complex', payload });
    const [read] = log.tailFrom(e.id - 1);
    expect(read?.payload).toEqual(payload);
  });
});
