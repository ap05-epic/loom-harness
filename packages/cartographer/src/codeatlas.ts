import { openDb, type Migration, type SqliteDatabase } from '@loom/core';
import type { JspForm } from './jsp-parser.js';

export const CODEATLAS_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'nodes_edges',
    sql: `
      CREATE TABLE ca_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE ca_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        src INTEGER NOT NULL,
        dst INTEGER NOT NULL,
        kind TEXT NOT NULL,
        meta_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_ca_nodes_kind ON ca_nodes(kind);
      CREATE INDEX idx_ca_nodes_name ON ca_nodes(name);
      CREATE INDEX idx_ca_edges_src ON ca_edges(src, kind);
      CREATE INDEX idx_ca_edges_dst ON ca_edges(dst, kind);
    `,
  },
  {
    version: 2,
    name: 'node_docs',
    // LLM-generated summaries (the recovered "missing documentation").
    sql: `ALTER TABLE ca_nodes ADD COLUMN doc TEXT;`,
  },
];

export type CaNode = {
  id: number;
  kind: string;
  name: string;
  path: string | null;
  meta: unknown;
  /** LLM-generated summary, if one has been produced. */
  doc: string | null;
};
export type Screen = {
  key: string;
  actionPath: string;
  actionType: string | null;
  formBean: string | null;
  viewJsps: string[];
};
export type ScreenSlice = {
  action: CaNode;
  formBean: CaNode | null;
  jsps: CaNode[];
  /** Forms parsed from the screen's view JSPs (fields, options, methods). */
  forms: JspForm[];
  /** Taglib prefixes the screen's JSPs declare. */
  taglibs: string[];
};

type NodeRow = {
  id: number;
  kind: string;
  name: string;
  path: string | null;
  meta_json: string;
  doc?: string | null;
};
const toNode = (r: NodeRow): CaNode => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  path: r.path,
  meta: JSON.parse(r.meta_json),
  doc: r.doc ?? null,
});

/** Derive a stable screen key from an action path: `/login` → `login`. */
export function screenKeyFromAction(actionPath: string): string {
  return actionPath.replace(/^\/+/, '').replace(/\//g, '-') || 'root';
}

/** The code map: a SQLite graph of the legacy source (actions, JSPs, form beans, edges). */
export class CodeAtlas {
  constructor(
    private readonly db: SqliteDatabase,
    readonly path: string,
  ) {}

  addNode(kind: string, name: string, path?: string, meta?: unknown): number {
    const r = this.db
      .prepare('INSERT INTO ca_nodes (kind, name, path, meta_json) VALUES (?, ?, ?, ?)')
      .run(kind, name, path ?? null, JSON.stringify(meta ?? {}));
    return Number(r.lastInsertRowid);
  }

  addEdge(src: number, dst: number, kind: string, meta?: unknown): void {
    this.db
      .prepare('INSERT INTO ca_edges (src, dst, kind, meta_json) VALUES (?, ?, ?, ?)')
      .run(src, dst, kind, JSON.stringify(meta ?? {}));
  }

  /** Find a node by (kind, name) or create it — the idempotent ingest primitive. */
  ensureNode(kind: string, name: string, path?: string, meta?: unknown): number {
    const existing = this.findNode(kind, name);
    return existing ? existing.id : this.addNode(kind, name, path, meta);
  }

  /** Replace a node's metadata (e.g. attaching parsed JSP forms to its jsp node). */
  setNodeMeta(id: number, meta: unknown): void {
    this.db.prepare('UPDATE ca_nodes SET meta_json = ? WHERE id = ?').run(JSON.stringify(meta), id);
  }

  /** Store an LLM-generated summary for a node (invalidates the search index). */
  setNodeDoc(id: number, doc: string): void {
    this.db.prepare('UPDATE ca_nodes SET doc = ? WHERE id = ?').run(doc, id);
    this.ftsState = 'unknown';
  }

  getNodeDoc(id: number): string | null {
    const r = this.db.prepare('SELECT doc FROM ca_nodes WHERE id = ?').get(id) as
      | { doc: string | null }
      | undefined;
    return r?.doc ?? null;
  }

  nodesByKind(kind: string): CaNode[] {
    return (this.db.prepare('SELECT * FROM ca_nodes WHERE kind = ?').all(kind) as NodeRow[]).map(
      toNode,
    );
  }

  /** All nodes (for whole-graph algorithms like the repo-map's PageRank). */
  allNodes(): CaNode[] {
    return (this.db.prepare('SELECT * FROM ca_nodes').all() as NodeRow[]).map(toNode);
  }

  /** All edges as (src, dst, kind) triples. */
  allEdges(): { src: number; dst: number; kind: string }[] {
    return this.db.prepare('SELECT src, dst, kind FROM ca_edges').all() as {
      src: number;
      dst: number;
      kind: string;
    }[];
  }

  /** Find a node by kind + name (the natural key for our node kinds). */
  findNode(kind: string, name: string): CaNode | null {
    const row = this.db
      .prepare('SELECT * FROM ca_nodes WHERE kind = ? AND name = ? LIMIT 1')
      .get(kind, name) as NodeRow | undefined;
    return row ? toNode(row) : null;
  }

  /** Neighbours reachable from a node along an edge kind. */
  linked(srcId: number, edgeKind: string): CaNode[] {
    const rows = this.db
      .prepare(
        `SELECT n.* FROM ca_nodes n JOIN ca_edges e ON e.dst = n.id WHERE e.src = ? AND e.kind = ?`,
      )
      .all(srcId, edgeKind) as NodeRow[];
    return rows.map(toNode);
  }

  private ftsState: 'unknown' | 'ready' | 'unavailable' = 'unknown';

  /** Build the FTS5 index over node names + kinds; false if FTS5 isn't compiled in. */
  private ensureFts(): boolean {
    if (this.ftsState !== 'unknown') return this.ftsState === 'ready';
    try {
      this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS ca_fts USING fts5(name, kind, doc)');
      this.db.exec('DELETE FROM ca_fts');
      const insert = this.db.prepare(
        'INSERT INTO ca_fts(rowid, name, kind, doc) VALUES (?, ?, ?, ?)',
      );
      for (const n of this.allNodes()) insert.run(n.id, n.name, n.kind, n.doc ?? '');
      this.ftsState = 'ready';
    } catch {
      this.ftsState = 'unavailable';
    }
    return this.ftsState === 'ready';
  }

  /**
   * Full-text search over node names/kinds (FTS5 BM25-ranked), with a LIKE
   * fallback if FTS5 is unavailable. The on-demand "find" tier of the oracle.
   */
  search(term: string, opts: { limit?: number } = {}): CaNode[] {
    const limit = opts.limit ?? 50;
    const tokens = term.match(/[a-z0-9]+/gi) ?? [];
    if (tokens.length && this.ensureFts()) {
      try {
        const query = tokens.map((t) => `"${t}"*`).join(' ');
        const rows = this.db
          .prepare(
            'SELECT n.* FROM ca_fts f JOIN ca_nodes n ON n.id = f.rowid WHERE ca_fts MATCH ? ORDER BY rank LIMIT ?',
          )
          .all(query, limit) as NodeRow[];
        return rows.map(toNode);
      } catch {
        // malformed FTS query → fall through to LIKE
      }
    }
    const like = `%${term}%`;
    return (
      this.db
        .prepare('SELECT * FROM ca_nodes WHERE name LIKE ? OR kind LIKE ? LIMIT ?')
        .all(like, like, limit) as NodeRow[]
    ).map(toNode);
  }

  /** Every action becomes a screen with its view JSP(s) and (optional) form bean. */
  screens(): Screen[] {
    return this.nodesByKind('action').map((action) => {
      const jsps = this.linked(action.id, 'renders').map((n) => n.name);
      const form = this.linked(action.id, 'uses_form')[0] ?? null;
      const meta = action.meta as { type?: string };
      return {
        key: screenKeyFromAction(action.name),
        actionPath: action.name,
        actionType: meta.type ?? null,
        formBean: (form?.meta as { type?: string } | undefined)?.type ?? null,
        viewJsps: jsps,
      };
    });
  }

  sliceForScreen(key: string): ScreenSlice | null {
    const action = this.nodesByKind('action').find((a) => screenKeyFromAction(a.name) === key);
    if (!action) return null;
    const jsps = this.linked(action.id, 'renders');
    const forms: JspForm[] = [];
    const taglibs = new Set<string>();
    for (const jsp of jsps) {
      const meta = jsp.meta as { forms?: JspForm[]; taglibs?: string[] };
      for (const form of meta.forms ?? []) forms.push(form);
      for (const prefix of meta.taglibs ?? []) taglibs.add(prefix);
    }
    return {
      action,
      formBean: this.linked(action.id, 'uses_form')[0] ?? null,
      jsps,
      forms,
      taglibs: [...taglibs],
    };
  }

  close(): void {
    this.db.close();
  }
}

/** Open (creating + migrating) a CodeAtlas database file. */
export function openCodeAtlas(path: string): CodeAtlas {
  const db = openDb(path);
  // forward-only migrations
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  );
  const applied = new Set(
    db
      .prepare('SELECT version FROM migrations')
      .all()
      .map((r) => (r as { version: number }).version),
  );
  for (const m of CODEATLAS_MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    })();
  }
  return new CodeAtlas(db, path);
}
