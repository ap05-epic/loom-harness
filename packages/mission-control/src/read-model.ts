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
  gates: Array<{ id: string; type: string; scopeId: string; payload: unknown }>;
  questions: Array<{ id: string; wpId: string | null; question: string; context: unknown }>;
  cost: { inputTokens: number; outputTokens: number; totalDurationMs: number; spans: number };
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
      gates: [],
      questions: [],
      cost: { inputTokens: 0, outputTokens: 0, totalDurationMs: 0, spans: 0 },
      recent: [],
    };
  }

  const wps = tasks.listWorkPackages(run.id);
  const screens = wps.map((w) => {
    const best = tasks.bestEval(w.id);
    return {
      wpId: w.id,
      screenKey: w.screenKey,
      state: w.state,
      diffPercent: best?.visualPct ?? null,
      attempts: tasks.listAttempts(w.id).length,
    };
  });
  const counts: Record<string, number> = {};
  for (const s of screens) counts[s.state] = (counts[s.state] ?? 0) + 1;

  const gates = new GateStore(db)
    .list({ status: 'open' })
    .map((g) => ({ id: g.id, type: g.type, scopeId: g.scopeId, payload: g.payload }));
  const questions = new QuestionStore(db)
    .list({ status: 'open' })
    .map((q) => ({ id: q.id, wpId: q.wpId, question: q.question, context: q.context }));

  const agg = new SpanStore(db).aggregate(run.id);
  const recent = new EventLog(db)
    .tailFrom(0, 5000, { runId: run.id })
    .slice(-(opts.recentLimit ?? 20))
    .map((e) => ({ id: e.id, ts: e.ts, type: e.type, wpId: e.wpId }));

  return {
    run: {
      id: run.id,
      project: run.project,
      status: run.status,
      stage: run.stage,
      harnessVersion: run.harnessVersion,
    },
    screens,
    counts,
    gates,
    questions,
    cost: {
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      totalDurationMs: agg.totalDurationMs,
      spans: agg.spans,
    },
    recent,
  };
}
