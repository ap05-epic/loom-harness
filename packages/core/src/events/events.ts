import type { SqliteDatabase } from '../db/sqlite-driver.js';

export type AppendEvent = {
  type: string;
  payload: unknown;
  runId?: string;
  wpId?: string;
  attemptId?: string;
};

export type HarnessEvent = {
  id: number;
  ts: string;
  type: string;
  payload: unknown;
  runId: string | null;
  wpId: string | null;
  attemptId: string | null;
};

type EventRow = {
  id: number;
  ts: string;
  type: string;
  payload_json: string;
  run_id: string | null;
  wp_id: string | null;
  attempt_id: string | null;
};

function toEvent(row: EventRow): HarnessEvent {
  return {
    id: row.id,
    ts: row.ts,
    type: row.type,
    payload: JSON.parse(row.payload_json),
    runId: row.run_id,
    wpId: row.wp_id,
    attemptId: row.attempt_id,
  };
}

/** Append-only event log over harness.db — the observability spine. */
export class EventLog {
  constructor(private readonly db: SqliteDatabase) {}

  append(event: AppendEvent): HarnessEvent {
    const result = this.db
      .prepare(
        `INSERT INTO events (type, payload_json, run_id, wp_id, attempt_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.type,
        JSON.stringify(event.payload ?? {}),
        event.runId ?? null,
        event.wpId ?? null,
        event.attemptId ?? null,
      );
    const row = this.db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(result.lastInsertRowid) as EventRow;
    return toEvent(row);
  }

  tailFrom(
    sinceId: number,
    limit = 1000,
    filter?: { runId?: string; wpId?: string },
  ): HarnessEvent[] {
    const clauses = ['id > ?'];
    const params: unknown[] = [sinceId];
    if (filter?.runId) {
      clauses.push('run_id = ?');
      params.push(filter.runId);
    }
    if (filter?.wpId) {
      clauses.push('wp_id = ?');
      params.push(filter.wpId);
    }
    params.push(limit);
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY id ASC LIMIT ?`)
      .all(...params) as EventRow[];
    return rows.map(toEvent);
  }
}
