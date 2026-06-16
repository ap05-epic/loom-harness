import { newId } from '../ids.js';
import { termScore } from '../db/relevance.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

/**
 * Where a skill comes from:
 * - `bundled` — ships with the harness (cross-project; `project` is null).
 * - `project` — authored for one project's conventions (scoped to that project).
 * - `generated` — drafted by the Reflector after a passed work package.
 */
export type SkillTier = 'bundled' | 'project' | 'generated';
/** Lifecycle: the Reflector drafts → a human approves → it becomes recallable. */
export type SkillStatus = 'draft' | 'active' | 'archived';

/**
 * Successful reuses an *active*, *generated* skill needs before it auto-promotes to the
 * bundled (global) tier. The human approval gate still happens first (draft → active);
 * promotion only graduates an already-proven skill so every project can recall it.
 */
export const DEFAULT_PROMOTE_AFTER = 3;

/** Outcome of {@link SkillStore.recordUse}. */
export type RecordUseResult = {
  /** The skill after this use is recorded (reflecting a promotion if one happened). */
  skill: Skill;
  /** True only on the use that crossed the threshold and promoted the skill to `bundled`. */
  promoted: boolean;
};

export type Skill = {
  id: string;
  /** null = global/bundled (shared across every project). */
  project: string | null;
  name: string;
  description: string;
  triggers: string[];
  body: string;
  tier: SkillTier;
  status: SkillStatus;
  useCount: number;
  successCount: number;
  createdAt: string;
  updatedAt: string;
};

type SkillRow = {
  id: string;
  project: string | null;
  name: string;
  description: string;
  triggers_json: string;
  body: string;
  tier: SkillTier;
  status: SkillStatus;
  use_count: number;
  success_count: number;
  created_at: string;
  updated_at: string;
};

const toSkill = (r: SkillRow): Skill => ({
  id: r.id,
  project: r.project,
  name: r.name,
  description: r.description,
  triggers: JSON.parse(r.triggers_json),
  body: r.body,
  tier: r.tier,
  status: r.status,
  useCount: r.use_count,
  successCount: r.success_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * The skill registry — the distilled, reusable migration knowledge that makes screen #50
 * convert faster than screen #5. The Reflector writes drafts; a human activates them; the
 * context packer recalls the *active* ones by relevance into Builder/Fixer work orders.
 */
export class SkillStore {
  constructor(private readonly db: SqliteDatabase) {}

  /** Register a skill, or update it in place when an existing `id` is supplied. */
  addSkill(input: {
    id?: string;
    project?: string;
    name: string;
    description?: string;
    triggers?: string[];
    body?: string;
    tier: SkillTier;
    status?: SkillStatus;
  }): Skill {
    if (input.id && this.get(input.id)) {
      this.db
        .prepare(
          `UPDATE skills_index SET project = ?, name = ?, description = ?, triggers_json = ?, body = ?,
           tier = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        )
        .run(
          input.project ?? null,
          input.name,
          input.description ?? '',
          JSON.stringify(input.triggers ?? []),
          input.body ?? '',
          input.tier,
          input.status ?? 'draft',
          input.id,
        );
      return this.get(input.id)!;
    }
    const id = input.id ?? newId('skill');
    this.db
      .prepare(
        `INSERT INTO skills_index (id, project, name, description, triggers_json, body, tier, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.project ?? null,
        input.name,
        input.description ?? '',
        JSON.stringify(input.triggers ?? []),
        input.body ?? '',
        input.tier,
        input.status ?? 'draft',
      );
    return this.get(id)!;
  }

  get(id: string): Skill | null {
    const r = this.db.prepare('SELECT * FROM skills_index WHERE id = ?').get(id) as
      | SkillRow
      | undefined;
    return r ? toSkill(r) : null;
  }

  /**
   * List skills for an inventory view — all of them by default (name order), optionally narrowed
   * by `status` and/or `project` (which includes the global/bundled tier, `project IS NULL`).
   */
  list(opts: { project?: string; status?: SkillStatus } = {}): Skill[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.project !== undefined) {
      clauses.push('(project IS NULL OR project = ?)');
      params.push(opts.project);
    }
    if (opts.status) {
      clauses.push('status = ?');
      params.push(opts.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM skills_index ${where} ORDER BY name ASC, id ASC`)
      .all(...params) as SkillRow[];
    return rows.map(toSkill);
  }

  setStatus(id: string, status: SkillStatus): void {
    this.db
      .prepare(
        `UPDATE skills_index SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(status, id);
  }

  /**
   * Record one use of a skill (and whether the work package it fed went on to pass), then
   * apply the **auto-promotion** policy: a human approves a draft once (draft → active at the
   * skill gate); thereafter a proven (≥ `promoteAfter` successes) *active*, *generated* skill
   * graduates to the bundled tier (`project` → null) so every project recalls it — its higher
   * `success_count` also lifts it in recall ranking. Drafts and project-scoped skills never
   * auto-promote: the human gate is never skipped and project conventions never leak global.
   */
  recordUse(
    id: string,
    outcome: { success: boolean },
    opts: { promoteAfter?: number } = {},
  ): RecordUseResult {
    this.db
      .prepare(
        `UPDATE skills_index SET use_count = use_count + 1, success_count = success_count + ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(outcome.success ? 1 : 0, id);
    const skill = this.get(id)!;
    const threshold = opts.promoteAfter ?? DEFAULT_PROMOTE_AFTER;
    const eligible =
      outcome.success &&
      skill.status === 'active' &&
      skill.tier === 'generated' &&
      skill.successCount >= threshold;
    if (!eligible) return { skill, promoted: false };
    this.db
      .prepare(
        `UPDATE skills_index SET tier = 'bundled', project = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(id);
    return { skill: this.get(id)!, promoted: true };
  }

  /**
   * Relevance recall for the context packer: the `active` skills (global + this project's)
   * whose name/description/triggers contain the most of the given terms. Ties prefer the
   * most-proven skill (success_count), then the most-used. Zero-match skills are excluded.
   */
  recall(
    project: string,
    opts: { terms: string[]; status?: SkillStatus; limit?: number },
  ): Skill[] {
    const terms = opts.terms.map((t) => t.trim()).filter(Boolean);
    if (terms.length === 0) return [];
    const { expr: scoreExpr, params: termParams } = termScore(
      "name || ' ' || description || ' ' || triggers_json",
      terms,
    );
    const status = opts.status ?? 'active';
    const limit = opts.limit ?? 6;
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT *, (${scoreExpr}) AS score FROM skills_index
            WHERE status = ? AND (project IS NULL OR project = ?)
         ) WHERE score > 0
         ORDER BY score DESC, success_count DESC, use_count DESC, id DESC LIMIT ?`,
      )
      .all(...termParams, status, project, limit) as SkillRow[];
    return rows.map(toSkill);
  }
}
