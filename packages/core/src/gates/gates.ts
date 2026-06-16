import { newId } from '../ids.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

/** The human decision points the conductor never auto-approves. */
export type GateType = 'plan' | 'deviation' | 'ship' | 'skill';
export type GateStatus = 'open' | 'approved' | 'rejected';

export type Gate = {
  id: string;
  scopeType: string;
  scopeId: string;
  type: GateType;
  status: GateStatus;
  payload: unknown;
  note: string | null;
};

type GateRow = {
  id: string;
  scope_type: string;
  scope_id: string;
  type: GateType;
  status: GateStatus;
  payload_json: string;
  note: string | null;
};

const toGate = (r: GateRow): Gate => ({
  id: r.id,
  scopeType: r.scope_type,
  scopeId: r.scope_id,
  type: r.type,
  status: r.status,
  payload: JSON.parse(r.payload_json),
  note: r.note,
});

/**
 * The gate inbox: plan / deviation / ship / skill decisions that a human must make. A shift
 * never auto-approves them — it opens a gate and keeps working non-gated tasks. Mission Control
 * (and `loom gates`) read open gates and record decisions here.
 */
export class GateStore {
  constructor(private readonly db: SqliteDatabase) {}

  /** Open a gate, or return the existing OPEN gate for the same scope+type (idempotent inbox). */
  open(input: { scopeType: string; scopeId: string; type: GateType; payload?: unknown }): Gate {
    const existing = this.db
      .prepare(
        "SELECT * FROM gates WHERE scope_type = ? AND scope_id = ? AND type = ? AND status = 'open' LIMIT 1",
      )
      .get(input.scopeType, input.scopeId, input.type) as GateRow | undefined;
    if (existing) return toGate(existing);
    const id = newId('gate');
    this.db
      .prepare(
        'INSERT INTO gates (id, scope_type, scope_id, type, payload_json) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.scopeType, input.scopeId, input.type, JSON.stringify(input.payload ?? {}));
    return this.get(id)!;
  }

  get(id: string): Gate | null {
    const r = this.db.prepare('SELECT * FROM gates WHERE id = ?').get(id) as GateRow | undefined;
    return r ? toGate(r) : null;
  }

  /** List gates (the inbox), newest-request order, filterable by status / type / scope. */
  list(filter?: { status?: GateStatus; type?: GateType; scopeType?: string }): Gate[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.type) {
      clauses.push('type = ?');
      params.push(filter.type);
    }
    if (filter?.scopeType) {
      clauses.push('scope_type = ?');
      params.push(filter.scopeType);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM gates ${where} ORDER BY requested_at, rowid`)
      .all(...params) as GateRow[];
    return rows.map(toGate);
  }

  /** Approve or reject an open gate, recording the decision note + timestamp. */
  decide(id: string, status: 'approved' | 'rejected', note?: string): Gate {
    this.db
      .prepare(
        `UPDATE gates SET status = ?, note = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(status, note ?? null, id);
    return this.get(id)!;
  }
}
