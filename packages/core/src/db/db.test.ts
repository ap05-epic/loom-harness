import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations, type Migration } from './db.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const m = (version: number, sql: string): Migration => ({ version, name: `m${version}`, sql });

describe('openDb', () => {
  test('creates the database file and enables WAL + foreign keys', () => {
    const db = openDb(join(dir, 'test.db'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});

describe('runMigrations', () => {
  test('applies migrations in version order and records them', () => {
    const db = openDb(join(dir, 'test.db'));
    const applied = runMigrations(db, [
      m(2, 'CREATE TABLE two (id INTEGER PRIMARY KEY);'),
      m(1, 'CREATE TABLE one (id INTEGER PRIMARY KEY);'),
    ]);
    expect(applied).toEqual([1, 2]);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('one');
    expect(tables).toContain('two');
    expect(tables).toContain('migrations');
    db.close();
  });

  test('is idempotent — re-running applies nothing', () => {
    const db = openDb(join(dir, 'test.db'));
    const migrations = [m(1, 'CREATE TABLE one (id INTEGER PRIMARY KEY);')];
    expect(runMigrations(db, migrations)).toEqual([1]);
    expect(runMigrations(db, migrations)).toEqual([]);
    db.close();
  });

  test('applies only newer migrations on upgrade', () => {
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db, [m(1, 'CREATE TABLE one (id INTEGER PRIMARY KEY);')]);
    const applied = runMigrations(db, [
      m(1, 'CREATE TABLE one (id INTEGER PRIMARY KEY);'),
      m(2, 'CREATE TABLE two (id INTEGER PRIMARY KEY);'),
    ]);
    expect(applied).toEqual([2]);
    db.close();
  });

  test('a failing migration rolls back atomically and records nothing', () => {
    const db = openDb(join(dir, 'test.db'));
    expect(() =>
      runMigrations(db, [m(1, 'CREATE TABLE one (id INTEGER PRIMARY KEY); CREATE TABLE broken (')]),
    ).toThrow();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='one'")
      .all();
    expect(tables).toHaveLength(0);
    const count = db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number };
    expect(count.c).toBe(0);
    db.close();
  });

  test('rejects duplicate migration versions in the provided set', () => {
    const db = openDb(join(dir, 'test.db'));
    expect(() =>
      runMigrations(db, [
        m(1, 'CREATE TABLE one (id INTEGER PRIMARY KEY);'),
        m(1, 'CREATE TABLE dup (id INTEGER PRIMARY KEY);'),
      ]),
    ).toThrow(/duplicate/i);
    db.close();
  });
});
