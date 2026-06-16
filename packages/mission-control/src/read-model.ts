import {
  EventLog,
  GateStore,
  QuestionStore,
  SpanStore,
  TaskStore,
  type SqliteDatabase,
} from '@loom/core';

/** The full read-only state one Mission Control poll needs — assembled from the stores. */
export type DashboardState = {
  run: {
    id: string;
    project: string;
    status: string;
    stage: string | null;
    harnessVersion: string | null;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  screens: Array<{
    wpId: string;
    screenKey: string | null;
    state: string;
    diffPercent: number | null;
    attempts: number;
  }>;
  /** Screen count by state — drives the pipeline tally. */
  counts: Record<string, number>;
  /** Workers currently active (building/evaluating/fixing) — the "Live Now" view. */
  liveNow: Array<{
    wpId: string;
    screenKey: string | null;
    state: string;
    attempt: number;
    lastEvent: string | null;
    lastEventTs: string | null;
  }>;
  gates: Array<{ id: string; type: string; scopeId: string; payload: unknown }>;
  questions: Array<{ id: string; wpId: string | null; question: string; context: unknown }>;
  cost: { inputTokens: number; outputTokens: number; totalDurationMs: number; spans: number };
  /** Token spend broken down by model — the cost view's "where did it go". */
  costByModel: Array<{ model: string; tokens: number; attempts: number }>;
  /** Eval analytics: pass rate + the failure-reason Pareto (which layer fails most). */
  evalAnalytics: {
    evaluated: number;
    passed: number;
    passRate: number;
    failureReasons: Array<{ reason: string; count: number }>;
  };
  recent: Array<{ id: number; ts: string; type: string; wpId: string | null }>;
};

/**
 * Assemble the dashboard state for one run (default: the latest running run, else the most
 * recent). Read-only — Mission Control renders this and writes back only gate/question
 * decisions. Pulls from the task graph, the gate/question inboxes, the span cost rollup, and
 * the event tail, all over the single `loom.db`.
 */
export function dashboardState(
  db: SqliteDatabase,
  runId?: string,
  opts: { recentLimit?: number } = {},
): DashboardState {
  const tasks = new TaskStore(db);
  const run = runId
    ? tasks.getRun(runId)
    : (tasks.latestRun({ status: 'running' }) ?? tasks.latestRun());
  if (!run) {
    return {
      run: null,
      screens: [],
      counts: {},
      liveNow: [],
      gates: [],
      questions: [],
      cost: { inputTokens: 0, outputTokens: 0, totalDurationMs: 0, spans: 0 },
      costByModel: [],
      evalAnalytics: { evaluated: 0, passed: 0, passRate: 0, failureReasons: [] },
      recent: [],
    };
  }

  const wps = tasks.listWorkPackages(run.id);
  // Read each WP's attempts + best eval once; reuse for screens, Live Now, and eval analytics.
  const attemptsByWp = new Map(wps.map((w) => [w.id, tasks.listAttempts(w.id)]));
  const bestByWp = new Map(wps.map((w) => [w.id, tasks.bestEval(w.id)]));
  const screens = wps.map((w) => ({
    wpId: w.id,
    screenKey: w.screenKey,
    state: w.state,
    diffPercent: bestByWp.get(w.id)?.visualPct ?? null,
    attempts: attemptsByWp.get(w.id)!.length,
  }));
  const counts: Record<string, number> = {};
  for (const s of screens) counts[s.state] = (counts[s.state] ?? 0) + 1;

  // Eval analytics: pass rate over evaluated screens + a Pareto of why attempts fail.
  const evaluated = wps.filter((w) => bestByWp.get(w.id)).length;
  const passed = wps.filter((w) => bestByWp.get(w.id)?.passed).length;
  const reasonCounts = new Map<string, number>();
  for (const w of wps) {
    for (const a of attemptsByWp.get(w.id)!) {
      if (a.status === 'failed' || a.status === 'guard_tripped') {
        const cat = failureCategory(a.failureReason);
        reasonCounts.set(cat, (reasonCounts.get(cat) ?? 0) + 1);
      }
    }
  }
  const evalAnalytics = {
    evaluated,
    passed,
    passRate: evaluated ? passed / evaluated : 0,
    failureReasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };

  const gates = new GateStore(db)
    .list({ status: 'open' })
    .map((g) => ({ id: g.id, type: g.type, scopeId: g.scopeId, payload: g.payload }));
  const questions = new QuestionStore(db)
    .list({ status: 'open' })
    .map((q) => ({ id: q.id, wpId: q.wpId, question: q.question, context: q.context }));

  const agg = new SpanStore(db).aggregate(run.id);
  const rollup = tasks.usageRollup(run.id);
  const costByModel = rollup.byModel
    .map((m) => ({ model: m.model, tokens: m.inputTokens + m.outputTokens, attempts: m.attempts }))
    .sort((a, b) => b.tokens - a.tokens);

  // One event tail powers both the recent feed and each active worker's last activity.
  const events = new EventLog(db).tailFrom(0, 5000, { runId: run.id });
  const lastEventByWp = new Map<string, { type: string; ts: string }>();
  for (const e of events) if (e.wpId) lastEventByWp.set(e.wpId, { type: e.type, ts: e.ts }); // ASC → last wins
  const ACTIVE = new Set(['building', 'evaluating', 'fixing']);
  const liveNow = wps
    .filter((w) => ACTIVE.has(w.state))
    .map((w) => {
      const le = lastEventByWp.get(w.id);
      return {
        wpId: w.id,
        screenKey: w.screenKey,
        state: w.state,
        attempt: attemptsByWp.get(w.id)!.length,
        lastEvent: le?.type ?? null,
        lastEventTs: le?.ts ?? null,
      };
    });
  const recent = events
    .slice(-(opts.recentLimit ?? 20))
    .map((e) => ({ id: e.id, ts: e.ts, type: e.type, wpId: e.wpId }));

  return {
    run: {
      id: run.id,
      project: run.project,
      status: run.status,
      stage: run.stage,
      harnessVersion: run.harnessVersion,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    screens,
    counts,
    liveNow,
    gates,
    questions,
    cost: {
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      totalDurationMs: agg.totalDurationMs,
      spans: agg.spans,
    },
    costByModel,
    evalAnalytics,
    recent,
  };
}

/** Bucket a free-text attempt failure reason into a Pareto category. */
function failureCategory(reason: string | null): string {
  const r = (reason ?? '').toLowerCase();
  if (!r) return 'unknown';
  if (r.includes('visual')) return 'visual diff';
  if (r.includes('structural')) return 'structural';
  if (r.includes('style')) return 'computed-style';
  if (r.includes('guard')) return 'guard tripped';
  if (r.includes('budget') || r.includes('token')) return 'budget';
  return 'other';
}
