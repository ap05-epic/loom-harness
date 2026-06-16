import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type SqliteBackend = 'better-sqlite3' | 'node:sqlite';

export type RunResult = { changes: number; lastInsertRowid: number | bigint };

export interface SqliteStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  readonly backend: SqliteBackend;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  /** Read or set a PRAGMA. With { simple: true } returns the first scalar value. */
  pragma(statement: string, options?: { simple?: boolean }): unknown;
  /** Wrap a function so it runs inside a transaction (mirrors better-sqlite3). */
  transaction(fn: () => void): () => void;
  close(): void;
}

export type OpenSqliteOptions = {
  /** Force a backend; defaults to env HARNESS_SQLITE_BACKEND, then auto-detect. */
  backend?: SqliteBackend;
};

// ---------------------------------------------------------------------------
// better-sqlite3 (native; primary on dev, used on pod when its prebuild loads)
// ---------------------------------------------------------------------------

type BetterDb = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...p: unknown[]): RunResult;
    get(...p: unknown[]): unknown;
    all(...p: unknown[]): unknown[];
  };
  pragma(s: string, o?: { simple?: boolean }): unknown;
  transaction(fn: () => void): () => void;
  close(): void;
};

function openBetterSqlite(path: string): SqliteDatabase {
  const Database = require('better-sqlite3') as new (p: string) => BetterDb;
  const db = new Database(path);
  return {
    backend: 'better-sqlite3',
    exec: (sql) => void db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    pragma: (s, o) => db.pragma(s, o),
    transaction: (fn) => db.transaction(fn),
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------------------
// node:sqlite (built into Node 22.5+; zero native install — the pod fallback)
// ---------------------------------------------------------------------------

type NodeStatement = {
  run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...p: unknown[]): unknown;
  all(...p: unknown[]): unknown[];
};
type NodeDb = {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
};

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function openNodeSqlite(path: string): SqliteDatabase {
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (p: string) => NodeDb;
  };
  const db = new DatabaseSync(path);
  let txDepth = 0;
  return {
    backend: 'node:sqlite',
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        run: (...p) => {
          const r = stmt.run(...p);
          return { changes: toNumber(r.changes), lastInsertRowid: toNumber(r.lastInsertRowid) };
        },
        get: (...p) => stmt.get(...p),
        all: (...p) => stmt.all(...p),
      };
    },
    pragma: (statement, options) => {
      const rows = db.prepare(`PRAGMA ${statement}`).all() as Record<string, unknown>[];
      if (options?.simple) {
        const first = rows[0];
        return first ? Object.values(first)[0] : undefined;
      }
      return rows;
    },
    transaction: (fn) => () => {
      // SQLite has no nested transactions; use savepoints when already inside one.
      const nested = txDepth > 0;
      const name = `sp_${txDepth}`;
      db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN');
      txDepth += 1;
      try {
        fn();
        db.exec(nested ? `RELEASE ${name}` : 'COMMIT');
      } catch (error) {
        db.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK');
        throw error;
      } finally {
        txDepth -= 1;
      }
    },
    close: () => db.close(),
  };
}

/**
 * Open a SQLite database behind a backend-neutral interface.
 *
 * Resolution order: explicit `backend` → `LOOM_SQLITE_BACKEND` (or legacy
 * `HARNESS_SQLITE_BACKEND`) env →
 * better-sqlite3 if its native module loads, else Node's built-in node:sqlite.
 * The fallback is what lets the harness install with zero native compilation
 * on locked-down pods.
 */
export function openSqlite(path: string, options: OpenSqliteOptions = {}): SqliteDatabase {
  const requested =
    options.backend ??
    (process.env.LOOM_SQLITE_BACKEND as SqliteBackend | undefined) ??
    (process.env.HARNESS_SQLITE_BACKEND as SqliteBackend | undefined);

  if (requested === 'better-sqlite3') return openBetterSqlite(path);
  if (requested === 'node:sqlite') return openNodeSqlite(path);
  if (requested !== undefined) {
    throw new Error(
      `Unknown SQLite backend "${requested}". Use "better-sqlite3" or "node:sqlite".`,
    );
  }

  try {
    return openBetterSqlite(path);
  } catch {
    return openNodeSqlite(path);
  }
}
