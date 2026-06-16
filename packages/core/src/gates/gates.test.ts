import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations } from '../db/db.js';
import { MIGRATIONS } from '../db/migrations.js';
import { GateStore } from './gates.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

let dir: string;
let db: SqliteDatabase;
let store: GateStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gates-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
  store = new GateStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GateStore', () => {
  test('opens a gate and reads it back with its payload', () => {
    const g = store.open({
      scopeType: 'skill',
      scopeId: 'skill_1',
      type: 'skill',
      payload: { name: 'struts-table-to-react' },
    });
    expect(g.id).toMatch(/^gate_/);
    expect(g.status).toBe('open');
    const got = store.get(g.id)!;
    expect(got.type).toBe('skill');
    expect(got.payload).toEqual({ name: 'struts-table-to-react' });
  });

  test('opening the same scope+type twice while open is idempotent (no duplicate inbox item)', () => {
    const a = store.open({ scopeType: 'skill', scopeId: 'skill_1', type: 'skill' });
    const b = store.open({ scopeType: 'skill', scopeId: 'skill_1', type: 'skill' });
    expect(b.id).toBe(a.id);
    expect(store.list({ status: 'open' })).toHaveLength(1);
  });

  test('lists open gates, filterable by type (the inbox)', () => {
    store.open({ scopeType: 'run', scopeId: 'run_1', type: 'plan' });
    store.open({ scopeType: 'skill', scopeId: 'skill_1', type: 'skill' });
    expect(store.list({ status: 'open' })).toHaveLength(2);
    expect(store.list({ status: 'open', type: 'skill' }).map((g) => g.scopeId)).toEqual([
      'skill_1',
    ]);
  });

  test('decide approves or rejects with a note and closes the gate', () => {
    const g = store.open({ scopeType: 'skill', scopeId: 'skill_1', type: 'skill' });
    const decided = store.decide(g.id, 'approved', 'looks reusable');
    expect(decided.status).toBe('approved');
    expect(decided.note).toBe('looks reusable');
    expect(store.list({ status: 'open' })).toHaveLength(0);
  });

  test('once a gate is decided, opening the same scope+type starts a fresh gate', () => {
    const a = store.open({ scopeType: 'run', scopeId: 'run_1', type: 'ship' });
    store.decide(a.id, 'rejected');
    const b = store.open({ scopeType: 'run', scopeId: 'run_1', type: 'ship' });
    expect(b.id).not.toBe(a.id);
    expect(b.status).toBe('open');
  });
});
