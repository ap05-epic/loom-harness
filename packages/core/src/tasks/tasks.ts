import { newId } from '../ids.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped';
export type Run = {
  id: string;
  project: string;
  stage: string | null;
  status: RunStatus;
  harnessVersion: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type WpState =
  | 'pending'
  | 'planned'
  | 'building'
  | 'evaluating'
  | 'fixing'
  | 'blocked'
  | 'needs_human'
  | 'passed'
  | 'shipped'
  | 'failed';

export type WorkPackage = {
  id: string;
  runId: string;
  kind: string;
  screenKey: string | null;
  title: string;
  spec: unknown;
  state: WpState;
  priority: number;
};

export type AttemptStatus = 'running' | 'passed' | 'failed' | 'interrupted' | 'guard_tripped';
export type Attempt = {
  id: string;
  wpId: string;
  n: number;
  role: string;
  status: AttemptStatus;
  pid: number | null;
  /** When this attempt began (ISO) — drives the live fleet view's "elapsed". */
  startedAt: string;
  /** When it finished (ISO), or null while still running. */
  finishedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  failureReason: string | null;
};

export type EvalScore = {
  id: string;
  wpId: string;
  attemptId: string | null;
  scorecard: unknown;
  visualPct: number | null;
  passed: boolean;
  isBest: boolean;
};

/** Token spend for a run, totalled and broken down by agent role and model. */
export type UsageRollup = {
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  byRole: Array<{ role: string; inputTokens: number; outputTokens: number; attempts: number }>;
  byModel: Array<{ model: string; inputTokens: number; outputTokens: number; attempts: number }>;
};

type RunRow = {
  id: string;
  project: string;
  stage: string | null;
  status: RunStatus;
  harness_version: string | null;
  started_at: string;
  finished_at: string | null;
};
type WpRow = {
  id: string;
  run_id: string;
  kind: string;
  screen_key: string | null;
  title: string;
  spec_json: string;
  state: WpState;
  priority: number;
};
type AttemptRow = {
  id: string;
  wp_id: string;
  n: number;
  role: string;
  status: AttemptStatus;
  pid: number | null;
  started_at: string;
  finished_at: string | null;
  input_tokens: number;
  output_tokens: number;
  failure_reason: string | null;
};
type EvalRow = {
  id: string;
  wp_id: string;
  attempt_id: string | null;
  scorecard_json: string;
  visual_pct: number | null;
  passed: number;
  is_best: number;
};

const toRun = (r: RunRow): Run => ({
  id: r.id,
  project: r.project,
  stage: r.stage,
  status: r.status,
  harnessVersion: r.harness_version,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});
const toWp = (r: WpRow): WorkPackage => ({
  id: r.id,
  runId: r.run_id,
  kind: r.kind,
  screenKey: r.screen_key,
  title: r.title,
  spec: JSON.parse(r.spec_json),
  state: r.state,
  priority: r.priority,
});
const toAttempt = (r: AttemptRow): Attempt => ({
  id: r.id,
  wpId: r.wp_id,
  n: r.n,
  role: r.role,
  status: r.status,
  pid: r.pid,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  failureReason: r.failure_reason,
});
const toEval = (r: EvalRow): EvalScore => ({
  id: r.id,
  wpId: r.wp_id,
  attemptId: r.attempt_id,
  scorecard: JSON.parse(r.scorecard_json),
  visualPct: r.visual_pct,
  passed: r.passed === 1,
  isBest: r.is_best === 1,
});

/** Typed accessor over the task graph in harness.db. The conductor writes; Mission Control reads. */
export class TaskStore {
  constructor(private readonly db: SqliteDatabase) {}

  // ---- runs ----
  createRun(input: { project: string; harnessVersion?: string }): Run {
    const id = newId('run');
    this.db
      .prepare('INSERT INTO runs (id, project, harness_version) VALUES (?, ?, ?)')
      .run(id, input.project, input.harnessVersion ?? null);
    return this.getRun(id)!;
  }
  getRun(id: string): Run | null {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
    return r ? toRun(r) : null;
  }
  setRunStage(id: string, stage: string): void {
    this.db.prepare('UPDATE runs SET stage = ? WHERE id = ?').run(stage, id);
  }
  /** The most recently created run, optionally filtered by status (for `loom resume`). */
  latestRun(filter?: { status?: RunStatus; project?: string }): Run | null {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.project) {
      clauses.push('project = ?');
      params.push(filter.project);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const r = this.db
      .prepare(`SELECT * FROM runs${where} ORDER BY rowid DESC LIMIT 1`)
      .get(...params) as RunRow | undefined;
    return r ? toRun(r) : null;
  }

  /** Distinct project names that have runs — powers the Mission Control project switcher. */
  projects(): string[] {
    return (
      this.db.prepare('SELECT DISTINCT project FROM runs ORDER BY project').all() as Array<{
        project: string;
      }>
    ).map((r) => r.project);
  }
  finishRun(id: string, status: RunStatus): void {
    this.db
      .prepare(
        `UPDATE runs SET status = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(status, id);
  }

  // ---- work packages ----
  createWorkPackage(input: {
    runId: string;
    title: string;
    screenKey?: string;
    kind?: string;
    spec?: unknown;
    priority?: number;
  }): WorkPackage {
    const id = newId('wp');
    this.db
      .prepare(
        'INSERT INTO work_packages (id, run_id, kind, screen_key, title, spec_json, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.runId,
        input.kind ?? 'screen',
        input.screenKey ?? null,
        input.title,
        JSON.stringify(input.spec ?? {}),
        input.priority ?? 0,
      );
    return this.getWorkPackage(id)!;
  }
  getWorkPackage(id: string): WorkPackage | null {
    const r = this.db.prepare('SELECT * FROM work_packages WHERE id = ?').get(id) as
      | WpRow
      | undefined;
    return r ? toWp(r) : null;
  }
  setWorkPackageState(id: string, state: WpState): void {
    this.db.prepare('UPDATE work_packages SET state = ? WHERE id = ?').run(state, id);
  }
  listWorkPackages(runId: string, filter?: { state?: WpState }): WorkPackage[] {
    const rows = filter?.state
      ? (this.db
          .prepare(
            'SELECT * FROM work_packages WHERE run_id = ? AND state = ? ORDER BY priority, created_at',
          )
          .all(runId, filter.state) as WpRow[])
      : (this.db
          .prepare('SELECT * FROM work_packages WHERE run_id = ? ORDER BY priority, created_at')
          .all(runId) as WpRow[]);
    return rows.map(toWp);
  }

  // ---- attempts ----
  createAttempt(input: {
    wpId: string;
    role: string;
    driver?: string;
    model?: string;
    pid?: number;
    branch?: string;
  }): Attempt {
    const id = newId('att');
    const n =
      (
        this.db
          .prepare('SELECT COALESCE(MAX(n), 0) AS m FROM attempts WHERE wp_id = ?')
          .get(input.wpId) as {
          m: number;
        }
      ).m + 1;
    this.db
      .prepare(
        'INSERT INTO attempts (id, wp_id, n, role, driver, model, pid, branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.wpId,
        n,
        input.role,
        input.driver ?? null,
        input.model ?? null,
        input.pid ?? null,
        input.branch ?? null,
      );
    return this.getAttempt(id)!;
  }
  getAttempt(id: string): Attempt | null {
    const r = this.db.prepare('SELECT * FROM attempts WHERE id = ?').get(id) as
      | AttemptRow
      | undefined;
    return r ? toAttempt(r) : null;
  }
  listAttempts(wpId: string): Attempt[] {
    return (
      this.db.prepare('SELECT * FROM attempts WHERE wp_id = ? ORDER BY n').all(wpId) as AttemptRow[]
    ).map(toAttempt);
  }
  finishAttempt(
    id: string,
    input: {
      status: AttemptStatus;
      inputTokens?: number;
      outputTokens?: number;
      failureReason?: string;
      stateHashAfter?: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE attempts SET status = ?, input_tokens = ?, output_tokens = ?, failure_reason = ?, state_hash_after = ?,
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(
        input.status,
        input.inputTokens ?? 0,
        input.outputTokens ?? 0,
        input.failureReason ?? null,
        input.stateHashAfter ?? null,
        id,
      );
  }

  // ---- evals ----
  recordEval(input: {
    wpId: string;
    attemptId?: string;
    scorecard: unknown;
    visualPct?: number;
    passed: boolean;
  }): EvalScore {
    const id = newId('eval');
    this.db
      .prepare(
        'INSERT INTO eval_scores (id, wp_id, attempt_id, scorecard_json, visual_pct, passed) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.wpId,
        input.attemptId ?? null,
        JSON.stringify(input.scorecard ?? {}),
        input.visualPct ?? null,
        input.passed ? 1 : 0,
      );
    this.recomputeBest(input.wpId);
    return toEval(this.db.prepare('SELECT * FROM eval_scores WHERE id = ?').get(id) as EvalRow);
  }
  /** Best = the lowest visual diff seen for the WP (ties keep the earliest). */
  private recomputeBest(wpId: string): void {
    this.db.prepare('UPDATE eval_scores SET is_best = 0 WHERE wp_id = ?').run(wpId);
    const best = this.db
      .prepare(
        'SELECT id FROM eval_scores WHERE wp_id = ? ORDER BY visual_pct IS NULL, visual_pct ASC, created_at ASC LIMIT 1',
      )
      .get(wpId) as { id: string } | undefined;
    if (best) this.db.prepare('UPDATE eval_scores SET is_best = 1 WHERE id = ?').run(best.id);
  }
  bestEval(wpId: string): EvalScore | null {
    const r = this.db
      .prepare('SELECT * FROM eval_scores WHERE wp_id = ? AND is_best = 1 LIMIT 1')
      .get(wpId) as EvalRow | undefined;
    return r ? toEval(r) : null;
  }

  // ---- crash resume ----
  /** Any attempt still 'running' on a fresh process is from a dead one — mark it interrupted. */
  reconcileInterrupted(): number {
    const running = this.db.prepare("SELECT id FROM attempts WHERE status = 'running'").all() as {
      id: string;
    }[];
    const stmt = this.db.prepare(
      `UPDATE attempts SET status = 'interrupted', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    );
    for (const r of running) stmt.run(r.id);
    return running.length;
  }

  // ---- usage / cost accounting ----
  /** Roll up the token spend recorded on a run's attempts, broken down by role and model. */
  usageRollup(runId: string): UsageRollup {
    const total = this.db
      .prepare(
        `SELECT COALESCE(SUM(a.input_tokens),0) AS i, COALESCE(SUM(a.output_tokens),0) AS o, COUNT(*) AS n
         FROM attempts a JOIN work_packages w ON a.wp_id = w.id WHERE w.run_id = ?`,
      )
      .get(runId) as { i: number; o: number; n: number };
    // col is a fixed literal ('role' | 'model'), never user input — safe to interpolate.
    const byCol = (col: 'role' | 'model') =>
      (
        this.db
          .prepare(
            `SELECT COALESCE(a.${col}, '?') AS k, SUM(a.input_tokens) AS i, SUM(a.output_tokens) AS o, COUNT(*) AS n
             FROM attempts a JOIN work_packages w ON a.wp_id = w.id
             WHERE w.run_id = ? GROUP BY a.${col} ORDER BY a.${col}`,
          )
          .all(runId) as Array<{ k: string; i: number; o: number; n: number }>
      ).map((r) => ({ k: r.k, inputTokens: r.i, outputTokens: r.o, attempts: r.n }));
    return {
      inputTokens: total.i,
      outputTokens: total.o,
      attempts: total.n,
      byRole: byCol('role').map(({ k, ...rest }) => ({ role: k, ...rest })),
      byModel: byCol('model').map(({ k, ...rest }) => ({ model: k, ...rest })),
    };
  }
}
