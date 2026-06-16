import { openDb, runMigrations, type Migration, type SqliteDatabase } from '@loom/core';
import type { UiState } from './crawl.js';
import { extractForms, type FormSpec } from './forms.js';
import { domSignature } from './state-identity.js';

/**
 * The UI atlas (`uiatlas.db`): the durable home for what the surveyor's crawler and AI-explorer
 * discover — every screen (state), the forms + validation rules on it, and the navigation edges
 * between them. The runtime counterpart to the cartographer's CodeAtlas; the deep-map swarm and the
 * Builder's work order read from it. Ingest is idempotent, so a re-crawl refreshes rather than
 * duplicates.
 */

export const UI_ATLAS_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'ua_states_forms_nav',
    sql: `
      CREATE TABLE ua_states (
        key TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        frame_path TEXT,
        dom_signature TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE ua_forms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_key TEXT NOT NULL,
        idx INTEGER NOT NULL,
        action TEXT,
        method TEXT,
        fields_json TEXT NOT NULL
      );
      CREATE TABLE ua_nav_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_key TEXT NOT NULL,
        to_url TEXT NOT NULL,
        via TEXT
      );
      CREATE INDEX idx_ua_forms_state ON ua_forms(state_key);
      CREATE INDEX idx_ua_nav_from ON ua_nav_edges(from_key);
    `,
  },
];

export type UaState = {
  key: string;
  url: string;
  framePath: string | null;
  domSignature: string | null;
};
export type NavEdge = { from: string; to: string; via?: string };

type StateRow = {
  key: string;
  url: string;
  frame_path: string | null;
  dom_signature: string | null;
};
type FormRow = { action: string | null; method: string | null; fields_json: string };
type NavRow = { from_key: string; to_url: string; via: string | null };

/** A SQLite-backed UI atlas: states, their forms, and the nav graph between them. */
export class UiAtlasStore {
  constructor(
    private readonly db: SqliteDatabase,
    readonly path: string,
  ) {}

  /** Insert or refresh a state. */
  upsertState(s: { key: string; url: string; framePath?: string; domSignature?: string }): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO ua_states (key, url, frame_path, dom_signature) VALUES (?, ?, ?, ?)',
      )
      .run(s.key, s.url, s.framePath ?? null, s.domSignature ?? null);
  }

  /** Replace a state's forms (idempotent). */
  recordForms(stateKey: string, forms: FormSpec[]): void {
    this.db.prepare('DELETE FROM ua_forms WHERE state_key = ?').run(stateKey);
    const insert = this.db.prepare(
      'INSERT INTO ua_forms (state_key, idx, action, method, fields_json) VALUES (?, ?, ?, ?, ?)',
    );
    forms.forEach((f, idx) =>
      insert.run(stateKey, idx, f.action ?? null, f.method ?? null, JSON.stringify(f.fields)),
    );
  }

  /** Replace a state's outgoing nav edges (idempotent). */
  recordNavEdges(fromKey: string, edges: Array<{ to: string; via?: string }>): void {
    this.db.prepare('DELETE FROM ua_nav_edges WHERE from_key = ?').run(fromKey);
    const insert = this.db.prepare(
      'INSERT INTO ua_nav_edges (from_key, to_url, via) VALUES (?, ?, ?)',
    );
    for (const e of edges) insert.run(fromKey, e.to, e.via ?? null);
  }

  /**
   * Persist a crawl/explore result: each state, its extracted forms, and its links as nav edges.
   * Idempotent — re-ingesting refreshes a state in place rather than duplicating.
   */
  ingest(states: UiState[]): void {
    for (const s of states) {
      this.upsertState({
        key: s.key,
        url: s.url,
        framePath: s.framePath,
        domSignature: domSignature(s.dom),
      });
      this.recordForms(s.key, extractForms(s.dom));
      this.recordNavEdges(
        s.key,
        s.links.map((to) => ({ to })),
      );
    }
  }

  states(): UaState[] {
    return (
      this.db
        .prepare('SELECT key, url, frame_path, dom_signature FROM ua_states')
        .all() as StateRow[]
    ).map((r) => ({
      key: r.key,
      url: r.url,
      framePath: r.frame_path,
      domSignature: r.dom_signature,
    }));
  }

  formsFor(stateKey: string): FormSpec[] {
    return (
      this.db
        .prepare(
          'SELECT action, method, fields_json FROM ua_forms WHERE state_key = ? ORDER BY idx',
        )
        .all(stateKey) as FormRow[]
    ).map((r) => ({
      ...(r.action ? { action: r.action } : {}),
      ...(r.method ? { method: r.method } : {}),
      fields: JSON.parse(r.fields_json) as FormSpec['fields'],
    }));
  }

  navEdges(): NavEdge[] {
    return (
      this.db.prepare('SELECT from_key, to_url, via FROM ua_nav_edges').all() as NavRow[]
    ).map((r) => ({ from: r.from_key, to: r.to_url, ...(r.via ? { via: r.via } : {}) }));
  }

  close(): void {
    this.db.close();
  }
}

/** Open (and migrate) a UI atlas database. */
export function openUiAtlas(path: string): UiAtlasStore {
  const db = openDb(path);
  runMigrations(db, UI_ATLAS_MIGRATIONS);
  return new UiAtlasStore(db, path);
}
