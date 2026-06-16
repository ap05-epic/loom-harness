import { EventLog, GateStore, QuestionStore, TaskStore, type SqliteDatabase } from '@loom/core';

/** A point-in-time snapshot of a run's health — the shift dashboard's "is it wedged?" signal. */
export type Heartbeat = {
  runId: string;
  stage: string | null;
  /** Work-package counts keyed by state (passed / building / blocked / …). */
  wpByState: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  /** Things waiting on a human — non-zero and rising means the shift is stalling. */
  openGates: number;
  openQuestions: number;
};

/** Snapshot a run's live state by reading the stores — pure, no side effects. */
export function heartbeat(db: SqliteDatabase, runId: string): Heartbeat {
  const store = new TaskStore(db);
  const usage = store.usageRollup(runId);
  const wpByState: Record<string, number> = {};
  for (const wp of store.listWorkPackages(runId)) {
    wpByState[wp.state] = (wpByState[wp.state] ?? 0) + 1;
  }
  return {
    runId,
    stage: store.getRun(runId)?.stage ?? null,
    wpByState,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    attempts: usage.attempts,
    openGates: new GateStore(db).list({ status: 'open' }).length,
    openQuestions: new QuestionStore(db).list({ status: 'open', runId }).length,
  };
}

/** Snapshot + append a `heartbeat` event so `loom watch` / Mission Control can tail it. */
export function emitHeartbeat(db: SqliteDatabase, runId: string): Heartbeat {
  const hb = heartbeat(db, runId);
  new EventLog(db).append({ type: 'heartbeat', runId, payload: hb });
  return hb;
}
