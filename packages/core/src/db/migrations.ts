import type { Migration } from './db.js';

/**
 * Forward-only migrations for harness.db. Never edit a released migration —
 * add a new version. (Pre-v0.1.0 the schema is still allowed to evolve in place.)
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'events',
    sql: `
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        run_id TEXT,
        wp_id TEXT,
        attempt_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_events_run ON events(run_id, id);
      CREATE INDEX idx_events_wp ON events(wp_id, id);
    `,
  },
];
