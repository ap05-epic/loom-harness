import { openSqlite, type OpenSqliteOptions, type SqliteDatabase } from './sqlite-driver.js';

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

/** Open (creating if needed) a SQLite database with the harness's standard pragmas. */
export function openDb(path: string, options: OpenSqliteOptions = {}): SqliteDatabase {
  const db = openSqlite(path, options);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Apply forward-only migrations in version order, each atomically (DDL + bookkeeping
 * in one transaction). Returns the versions applied in this call.
 */
export function runMigrations(db: SqliteDatabase, migrations: Migration[]): number[] {
  const versions = migrations.map((m) => m.version);
  if (new Set(versions).size !== versions.length) {
    throw new Error('duplicate migration versions provided');
  }

  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`,
  );

  const alreadyApplied = new Set(
    db
      .prepare('SELECT version FROM migrations')
      .all()
      .map((r) => (r as { version: number }).version),
  );

  const pending = [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((m) => !alreadyApplied.has(m.version));

  const record = db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)');
  const applied: number[] = [];
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name);
    })();
    applied.push(migration.version);
  }
  return applied;
}
