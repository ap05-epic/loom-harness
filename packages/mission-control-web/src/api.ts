import type { Screen } from './lib/board';

/*
 * Typed views of the harness JSON endpoints. The shapes mirror @loom/mission-control's read-model
 * (the server is the source of truth); kept deliberately small — the dashboard only reads.
 */

export type RunInfo = {
  id: string;
  project: string;
  status: string;
  stage: string | null;
  harnessVersion: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type LiveWorker = {
  wpId: string;
  screenKey: string | null;
  state: string;
  attempt: number;
  startedAt: string | null;
  tokens: number;
  lastEvent: string | null;
  lastEventTs: string | null;
};

export type Gate = { id: string; type: string; scopeId: string; payload: unknown };
export type Question = { id: string; wpId: string | null; question: string; context: unknown };

export type DashboardState = {
  run: RunInfo | null;
  screens: Screen[];
  counts: Record<string, number>;
  liveNow: LiveWorker[];
  gates: Gate[];
  questions: Question[];
  cost: { inputTokens: number; outputTokens: number; totalDurationMs: number; spans: number };
  costByModel: Array<{ model: string; tokens: number; attempts: number }>;
  evalAnalytics: {
    evaluated: number;
    passed: number;
    passRate: number;
    failureReasons: Array<{ reason: string; count: number }>;
  };
  recent: Array<{ id: number; ts: string; type: string; wpId: string | null }>;
};

/** Fetch + parse JSON from a harness endpoint; throws on a non-2xx so React Query surfaces the error. */
export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

const q = (project?: string): string => (project ? `?project=${encodeURIComponent(project)}` : '');

export const fetchState = (project?: string): Promise<DashboardState> =>
  getJson<DashboardState>(`/api/state${q(project)}`);
