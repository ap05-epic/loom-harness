import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openSqlite, type SqliteBackend } from './sqlite-driver.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-sqlite-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const BACKENDS: SqliteBackend[] = ['better-sqlite3', 'node:sqlite'];

describe.each(BACKENDS)('SqliteDatabase via %s', (backend) => {
  test('reports its backend name', () => {
    const db = openSqlite(join(dir, `${backend.replace(/\W/g, '_')}.db`), { backend });
    expect(db.backend).toBe(backend);
    db.close();
  });

  test('exec + prepare/run/get/all round-trip with positional params', () => {
    const db = openSqlite(join(dir, `rt-${backend.replace(/\W/g, '_')}.db`), { backend });
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    const insert = db.prepare('INSERT INTO t (name) VALUES (?)');
    const r1 = insert.run('alpha');
    const r2 = insert.run('beta');
    expect(r1.changes).toBe(1);
    expect(Number(r1.lastInsertRowid)).toBe(1);
    expect(Number(r2.lastInsertRowid)).toBe(2);

    const one = db.prepare('SELECT name FROM t WHERE id = ?').get(1) as { name: string };
    expect(one.name).toBe('alpha');
    const all = db.prepare('SELECT name FROM t ORDER BY id').all() as { name: string }[];
    expect(all.map((r) => r.name)).toEqual(['alpha', 'beta']);
    db.close();
  });

  test('transaction commits on success and rolls back on throw', () => {
    const db = openSqlite(join(dir, `tx-${backend.replace(/\W/g, '_')}.db`), { backend });
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const ins = db.prepare('INSERT INTO t (v) VALUES (?)');

    db.transaction(() => {
      ins.run('committed');
    })();
    expect((db.prepare('SELECT COUNT(*) c FROM t').get() as { c: number }).c).toBe(1);

    expect(() =>
      db.transaction(() => {
        ins.run('doomed');
        throw new Error('rollback please');
      })(),
    ).toThrow(/rollback please/);
    expect((db.prepare('SELECT COUNT(*) c FROM t').get() as { c: number }).c).toBe(1);
    db.close();
  });

  test('pragma reads a scalar with { simple: true }', () => {
    const db = openSqlite(join(dir, `pragma-${backend.replace(/\W/g, '_')}.db`), { backend });
    db.exec('PRAGMA journal_mode = WAL');
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    db.close();
  });
});

describe('openSqlite auto-detection', () => {
  test('auto backend yields a working database and a known backend name', () => {
    const db = openSqlite(join(dir, 'auto.db'));
    expect(['better-sqlite3', 'node:sqlite']).toContain(db.backend);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO t DEFAULT VALUES').run();
    expect((db.prepare('SELECT COUNT(*) c FROM t').get() as { c: number }).c).toBe(1);
    db.close();
  });

  test('an explicit unavailable backend throws a clear error', () => {
    expect(() =>
      openSqlite(join(dir, 'nope.db'), { backend: 'not-a-backend' as SqliteBackend }),
    ).toThrow(/backend/i);
  });
});
