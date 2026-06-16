import { newId } from '../ids.js';
import { termScore } from '../db/relevance.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

/**
 * What a memory is *about*:
 * - `project_fact` — a stable convention discovered while working ("dates render dd.MM.yyyy").
 * - `worklog` — the OpenClaw task-flow record for one WP: what was tried and what blocked,
 *   packed back into retry attempts so the Fixer never repeats a dead end.
 * - `reflection` — a distilled summary of a run/shift (progress, recurring failure patterns).
 */
export type MemoryKind = 'project_fact' | 'worklog' | 'reflection';

/** Outcome of {@link MemoryStore.consolidate}. */
export type ConsolidateResult = {
  /** Facts forgotten as exact duplicates of a newer fact. */
  deduped: number;
  /** Facts forgotten to keep the set under `maxFacts` (oldest first). */
  trimmed: number;
  /** Facts remaining after consolidation. */
  kept: number;
};

export type Memory = {
  id: string;
  project: string;
  kind: MemoryKind;
  /** Optional owner — e.g. the `wp_id` for a worklog, the `run_id` for a reflection. */
  scopeId: string | null;
  title: string;
  body: string;
  meta: unknown;
  createdAt: string;
  updatedAt: string;
};

type MemoryRow = {
  id: string;
  project: string;
  kind: MemoryKind;
  scope_id: string | null;
  title: string;
  body: string;
  meta_json: string;
  created_at: string;
  updated_at: string;
};

const toMemory = (r: MemoryRow): Memory => ({
  id: r.id,
  project: r.project,
  kind: r.kind,
  scopeId: r.scope_id,
  title: r.title,
  body: r.body,
  meta: JSON.parse(r.meta_json),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * The harness's long-term memory, scoped per project (one project's memory never leaks
 * into another). The Reflector writes it; the context packer recalls it into work orders.
 * Markdown bodies live in the row; relevance recall is backend-agnostic (no FTS dependency).
 */
export class MemoryStore {
  constructor(private readonly db: SqliteDatabase) {}

  /** Insert a memory, or update it in place when an existing `id` is supplied (human edits / dedup). */
  remember(input: {
    id?: string;
    project: string;
    kind: MemoryKind;
    title: string;
    body: string;
    scopeId?: string;
    meta?: unknown;
  }): Memory {
    if (input.id && this.get(input.id)) {
      this.db
        .prepare(
          `UPDATE memory_index SET kind = ?, scope_id = ?, title = ?, body = ?, meta_json = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        )
        .run(
          input.kind,
          input.scopeId ?? null,
          input.title,
          input.body,
          JSON.stringify(input.meta ?? {}),
          input.id,
        );
      return this.get(input.id)!;
    }
    const id = input.id ?? newId('mem');
    this.db
      .prepare(
        'INSERT INTO memory_index (id, project, kind, scope_id, title, body, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.project,
        input.kind,
        input.scopeId ?? null,
        input.title,
        input.body,
        JSON.stringify(input.meta ?? {}),
      );
    return this.get(id)!;
  }

  get(id: string): Memory | null {
    const r = this.db.prepare('SELECT * FROM memory_index WHERE id = ?').get(id) as
      | MemoryRow
      | undefined;
    return r ? toMemory(r) : null;
  }

  /** List a project's memories, newest first, optionally narrowed to a kind and/or scope. */
  list(project: string, filter?: { kind?: MemoryKind; scopeId?: string }): Memory[] {
    const clauses = ['project = ?'];
    const params: unknown[] = [project];
    if (filter?.kind) {
      clauses.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter?.scopeId) {
      clauses.push('scope_id = ?');
      params.push(filter.scopeId);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_index WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(...params) as MemoryRow[];
    return rows.map(toMemory);
  }

  /**
   * Relevance recall for the context packer: a project's memories ranked by how many of
   * the given terms appear in title+body. Zero-match memories are excluded; ties break by
   * recency. Scoped to one project so memory can never leak across projects.
   */
  recall(project: string, opts: { terms: string[]; kind?: MemoryKind; limit?: number }): Memory[] {
    const terms = opts.terms.map((t) => t.trim()).filter(Boolean);
    if (terms.length === 0) return [];
    const { expr: scoreExpr, params: termParams } = termScore("title || ' ' || body", terms);
    const clauses = ['project = ?'];
    const whereParams: unknown[] = [project];
    if (opts.kind) {
      clauses.push('kind = ?');
      whereParams.push(opts.kind);
    }
    const limit = opts.limit ?? 8;
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT *, (${scoreExpr}) AS score FROM memory_index WHERE ${clauses.join(' AND ')}
         ) WHERE score > 0 ORDER BY score DESC, updated_at DESC, id DESC LIMIT ?`,
      )
      .all(...termParams, ...whereParams, limit) as MemoryRow[];
    return rows.map(toMemory);
  }

  forget(id: string): void {
    this.db.prepare('DELETE FROM memory_index WHERE id = ?').run(id);
  }

  /**
   * Compact a project's `project_fact` memory so it stays bounded as the Reflector
   * re-discovers the same conventions shift after shift. Two loss-safe passes:
   *  1. **dedup** — facts whose normalized body (lowercased, whitespace-collapsed) match a
   *     newer fact are forgotten; the newest copy is kept.
   *  2. **trim** — when `maxFacts` is set and facts still exceed it, the oldest beyond the cap
   *     are forgotten (the most-recent survive).
   * Worklog/reflection memories and other projects are never touched.
   */
  consolidate(project: string, opts: { maxFacts?: number } = {}): ConsolidateResult {
    const facts = this.list(project, { kind: 'project_fact' }); // newest first
    const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const seen = new Set<string>();
    const survivors: Memory[] = [];
    let deduped = 0;
    for (const fact of facts) {
      const key = norm(fact.body);
      if (seen.has(key)) {
        this.forget(fact.id);
        deduped += 1;
      } else {
        seen.add(key);
        survivors.push(fact);
      }
    }
    let trimmed = 0;
    if (opts.maxFacts !== undefined && survivors.length > opts.maxFacts) {
      for (const fact of survivors.slice(opts.maxFacts)) {
        this.forget(fact.id);
        trimmed += 1;
      }
    }
    return { deduped, trimmed, kept: survivors.length - trimmed };
  }
}
