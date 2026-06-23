import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDb, runMigrations, type Migration, type SqliteDatabase } from '@loom/core';
import { redactBody } from './crawl-guard.js';

/**
 * The runtime crawl graph: states (screens, by screenKey × FA‑state), the typed state→state user
 * paths, each screen's data endpoints + payloads, and the value→endpoint provenance. Redaction happens
 * STORE‑SIDE (the store holds the secrets), so nothing un‑redacted can be persisted by accident.
 */
export const CRAWL_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'crawl_graph',
    sql: `
      CREATE TABLE crawl_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        finished_at TEXT, status TEXT NOT NULL DEFAULT 'running',
        start_url TEXT, budgets_json TEXT NOT NULL DEFAULT '{}', meta_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE crawl_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL, url TEXT NOT NULL, frame_path TEXT, dom_signature TEXT,
        state_tag TEXT NOT NULL, screenshot_path TEXT, dom_path TEXT, title TEXT,
        discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        meta_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(key, state_tag)
      );
      CREATE TABLE crawl_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_state_id INTEGER NOT NULL REFERENCES crawl_states(id),
        to_state_id INTEGER REFERENCES crawl_states(id),
        action_kind TEXT NOT NULL, action_target TEXT, label TEXT, kind TEXT,
        is_new_state INTEGER NOT NULL DEFAULT 0, is_destructive INTEGER NOT NULL DEFAULT 0,
        followed INTEGER NOT NULL DEFAULT 0, sig TEXT NOT NULL, meta_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(from_state_id, sig)
      );
      CREATE TABLE crawl_endpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_id INTEGER NOT NULL REFERENCES crawl_states(id),
        method TEXT NOT NULL, url TEXT NOT NULL, resource_type TEXT, status INTEGER,
        body_path TEXT, body_bytes INTEGER, meta_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(state_id, method, url)
      );
      CREATE TABLE crawl_provenance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_id INTEGER NOT NULL REFERENCES crawl_states(id),
        value TEXT NOT NULL, endpoint_id INTEGER REFERENCES crawl_endpoints(id),
        label TEXT, meta_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_crawl_states_key ON crawl_states(key, state_tag);
      CREATE INDEX idx_crawl_inter_from ON crawl_interactions(from_state_id);
      CREATE INDEX idx_crawl_endpoints_state ON crawl_endpoints(state_id);
      CREATE INDEX idx_crawl_prov_state ON crawl_provenance(state_id);
    `,
  },
];

export type CrawlStateRow = {
  id: number;
  key: string;
  url: string;
  state_tag: string;
  screenshot_path: string | null;
  title: string | null;
};
export type CrawlInteractionRow = {
  id: number;
  from_state_id: number;
  to_state_id: number | null;
  action_kind: string;
  action_target: string | null;
  label: string | null;
  kind: string | null;
  is_new_state: number;
  is_destructive: number;
  followed: number;
};
export type CrawlEndpointRow = {
  id: number;
  state_id: number;
  method: string;
  url: string;
  status: number | null;
  body_path: string | null;
};
export type CrawlProvenanceRow = {
  id: number;
  state_id: number;
  value: string;
  endpoint_id: number | null;
  label: string | null;
};

/** Persistent store for the crawl graph. Constructed with the secrets so it can redact store‑side. */
export class CrawlStore {
  constructor(
    private readonly db: SqliteDatabase,
    readonly path: string,
    private readonly bodiesDir: string,
    private readonly secrets: string[],
  ) {
    mkdirSync(bodiesDir, { recursive: true });
  }

  private redact(s: string): string {
    return redactBody(s, this.secrets);
  }

  startRun(input: { startUrl?: string; budgets?: unknown }): number {
    const r = this.db
      .prepare('INSERT INTO crawl_runs (start_url, budgets_json) VALUES (?, ?)')
      .run(
        input.startUrl ? this.redact(input.startUrl) : null,
        JSON.stringify(input.budgets ?? {}),
      );
    return Number(r.lastInsertRowid);
  }
  finishRun(runId: number, status: 'done' | 'aborted'): void {
    this.db
      .prepare(
        "UPDATE crawl_runs SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), status = ? WHERE id = ?",
      )
      .run(status, runId);
  }

  /** Insert‑or‑get a state by (key, state_tag) — the dedup identity. */
  upsertState(s: {
    key: string;
    url: string;
    framePath?: string;
    domSignature?: string;
    stateTag: string;
    screenshotPath?: string;
    domPath?: string;
    title?: string;
    meta?: unknown;
  }): number {
    const existing = this.db
      .prepare('SELECT id FROM crawl_states WHERE key = ? AND state_tag = ?')
      .get(s.key, s.stateTag) as { id: number } | undefined;
    if (existing) return existing.id;
    const r = this.db
      .prepare(
        `INSERT INTO crawl_states (key, url, frame_path, dom_signature, state_tag, screenshot_path, dom_path, title, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.key,
        this.redact(s.url),
        s.framePath ?? null,
        s.domSignature ?? null,
        s.stateTag,
        s.screenshotPath ?? null,
        s.domPath ?? null,
        s.title ? this.redact(s.title) : null,
        JSON.stringify(s.meta ?? {}),
      );
    return Number(r.lastInsertRowid);
  }

  /** Record an interaction edge (idempotent by (from_state_id, sig)); returns the row id. */
  recordInteraction(e: {
    fromStateId: number;
    toStateId?: number;
    actionKind: string;
    actionTarget?: string;
    label?: string;
    kind?: string;
    isNewState?: boolean;
    isDestructive?: boolean;
    followed?: boolean;
    sig: string;
    meta?: unknown;
  }): number {
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO crawl_interactions
           (from_state_id, to_state_id, action_kind, action_target, label, kind, is_new_state, is_destructive, followed, sig, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.fromStateId,
        e.toStateId ?? null,
        e.actionKind,
        e.actionTarget ? this.redact(e.actionTarget) : null,
        e.label ? this.redact(e.label) : null,
        e.kind ?? null,
        e.isNewState ? 1 : 0,
        e.isDestructive ? 1 : 0,
        e.followed ? 1 : 0,
        e.sig,
        JSON.stringify(e.meta ?? {}),
      );
    if (r.changes > 0) return Number(r.lastInsertRowid);
    const row = this.db
      .prepare('SELECT id FROM crawl_interactions WHERE from_state_id = ? AND sig = ?')
      .get(e.fromStateId, e.sig) as { id: number };
    return row.id;
  }
  patchInteractionTo(interactionId: number, toStateId: number, isNewState: boolean): void {
    this.db
      .prepare('UPDATE crawl_interactions SET to_state_id = ?, is_new_state = ? WHERE id = ?')
      .run(toStateId, isNewState ? 1 : 0, interactionId);
  }

  /** Record an endpoint + write its (redacted) response body to disk; idempotent by (state, method, url). */
  recordEndpoint(e: {
    stateId: number;
    method: string;
    url: string;
    resourceType?: string;
    status?: number;
    body?: string;
    meta?: unknown;
  }): number {
    let bodyPath: string | null = null;
    let bodyBytes: number | null = null;
    if (e.body) {
      const red = redactBody(e.body, this.secrets);
      bodyBytes = red.length;
      const name = `${createHash('sha256').update(`${e.method} ${e.url} ${red}`).digest('hex').slice(0, 16)}.txt`;
      const p = join(this.bodiesDir, name);
      try {
        writeFileSync(p, red);
        bodyPath = p;
      } catch {
        bodyPath = null; // fs failure → just no body, never throw
      }
    }
    const url = this.redact(e.url);
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO crawl_endpoints (state_id, method, url, resource_type, status, body_path, body_bytes, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.stateId,
        e.method,
        url,
        e.resourceType ?? null,
        e.status ?? null,
        bodyPath,
        bodyBytes,
        JSON.stringify(e.meta ?? {}),
      );
    if (r.changes > 0) return Number(r.lastInsertRowid);
    const row = this.db
      .prepare('SELECT id FROM crawl_endpoints WHERE state_id = ? AND method = ? AND url = ?')
      .get(e.stateId, e.method, url) as { id: number };
    return row.id;
  }

  recordProvenance(p: {
    stateId: number;
    value: string;
    endpointId?: number;
    label?: string;
    meta?: unknown;
  }): void {
    this.db
      .prepare(
        'INSERT INTO crawl_provenance (state_id, value, endpoint_id, label, meta_json) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        p.stateId,
        this.redact(p.value),
        p.endpointId ?? null,
        p.label ? this.redact(p.label) : null,
        JSON.stringify(p.meta ?? {}),
      );
  }

  /** `${key}::${state_tag}` for every recorded state — the DFS visited‑set (cross‑run resume). */
  seenStateKeys(): Set<string> {
    const rows = this.db.prepare('SELECT key, state_tag FROM crawl_states').all() as Array<{
      key: string;
      state_tag: string;
    }>;
    return new Set(rows.map((r) => `${r.key}::${r.state_tag}`));
  }
  triedSigs(fromStateId: number): Set<string> {
    const rows = this.db
      .prepare('SELECT sig FROM crawl_interactions WHERE from_state_id = ?')
      .all(fromStateId) as Array<{ sig: string }>;
    return new Set(rows.map((r) => r.sig));
  }
  hasEdge(fromStateId: number, sig: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM crawl_interactions WHERE from_state_id = ? AND sig = ?')
        .get(fromStateId, sig),
    );
  }
  stateIdFor(key: string, stateTag: string): number | undefined {
    const r = this.db
      .prepare('SELECT id FROM crawl_states WHERE key = ? AND state_tag = ?')
      .get(key, stateTag) as { id: number } | undefined;
    return r?.id;
  }

  states(): CrawlStateRow[] {
    return this.db
      .prepare('SELECT id, key, url, state_tag, screenshot_path, title FROM crawl_states')
      .all() as CrawlStateRow[];
  }
  interactionsFor(stateId: number): CrawlInteractionRow[] {
    return this.db
      .prepare('SELECT * FROM crawl_interactions WHERE from_state_id = ?')
      .all(stateId) as CrawlInteractionRow[];
  }
  endpointsFor(stateId: number): CrawlEndpointRow[] {
    return this.db
      .prepare(
        'SELECT id, state_id, method, url, status, body_path FROM crawl_endpoints WHERE state_id = ?',
      )
      .all(stateId) as CrawlEndpointRow[];
  }
  provenanceFor(stateId: number): Array<CrawlProvenanceRow & { endpoint_url: string | null }> {
    return this.db
      .prepare(
        `SELECT p.id, p.state_id, p.value, p.endpoint_id, p.label, e.url AS endpoint_url
         FROM crawl_provenance p LEFT JOIN crawl_endpoints e ON e.id = p.endpoint_id WHERE p.state_id = ?`,
      )
      .all(stateId) as Array<CrawlProvenanceRow & { endpoint_url: string | null }>;
  }
  graph(): { states: CrawlStateRow[]; edges: CrawlInteractionRow[] } {
    return {
      states: this.states(),
      edges: this.db.prepare('SELECT * FROM crawl_interactions').all() as CrawlInteractionRow[],
    };
  }

  close(): void {
    this.db.close();
  }
}

/** Open (or create + migrate) a crawl DB. `bodiesDir` is where redacted response payloads are written. */
export function openCrawlDb(
  path: string,
  opts: { bodiesDir: string; secrets?: string[] },
): CrawlStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = openDb(path);
  runMigrations(db, CRAWL_MIGRATIONS);
  return new CrawlStore(db, path, opts.bodiesDir, opts.secrets ?? []);
}
