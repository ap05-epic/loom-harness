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

/** The live state of a `loom explore` crawl — mirrors @loom/mission-control's ExploreState. */
export type ExploreState = {
  run: {
    id: string;
    project: string;
    status: string;
    stage: string | null;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  current: {
    url: string | null;
    lastAction: string | null;
    lastLabel: string | null;
    lastEventTs: string | null;
  };
  screens: Array<{ key: string; url: string | null; index: number }>;
  moves: Array<{
    ts: string;
    action: string;
    label: string | null;
    isNew: boolean;
    discovered: number;
  }>;
  totals: {
    screens: number;
    steps: number;
    inputTokens: number;
    outputTokens: number;
    tokens: number;
    elapsedMs: number;
    tokensPerSec: number;
    truncated: boolean;
    done: boolean;
  };
};

export const fetchExplore = (project?: string): Promise<ExploreState> =>
  getJson<ExploreState>(`/api/explore${q(project)}`);

/** URL of a discovered screen's thumbnail (served path-confined by the harness). */
export const exploreShotUrl = (key: string): string =>
  `/api/explore-shot/${encodeURIComponent(key)}.png`;

/** The projects the harness knows about (∪ the active one). */
export type ProjectList = { active: string | null; projects: string[] };
export const fetchProjects = (): Promise<ProjectList> => getJson<ProjectList>('/api/projects');

/** One work package's drill-down — mirrors @loom/mission-control's WpDetail. */
export type WpDetail = {
  wpId: string;
  screenKey: string | null;
  state: string;
  attempts: Array<{
    n: number;
    role: string;
    status: string;
    inputTokens: number;
    outputTokens: number;
    failureReason: string | null;
  }>;
  bestEval: { visualPct: number | null; passed: boolean } | null;
};
export const fetchWpDetail = (wpId: string): Promise<WpDetail> =>
  getJson<WpDetail>(`/api/wp/${encodeURIComponent(wpId)}`);

/** The harness's capability inventory — mirrors @loom/mission-control's Inventory. */
export type Inventory = {
  tools: Array<{ name: string; category: string; description: string }>;
  mcpExternal: Array<{ name: string; description: string }>;
  skills: Array<{
    name: string;
    description: string;
    tier: string;
    status: string;
    useCount: number;
    successCount: number;
    source: 'db' | 'file';
  }>;
  digit: { home: string; skills: unknown[]; agents: unknown[]; mcp: unknown[] };
};
export const fetchInventory = (project?: string): Promise<Inventory> =>
  getJson<Inventory>(`/api/inventory${q(project)}`);

/** POST a JSON body to a harness endpoint (the only writes Mission Control performs). */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Approve or reject an open gate (ship/skill/plan/deviation). */
export const decideGate = (id: string, decision: 'approve' | 'reject', note?: string) =>
  postJson<{ status: string }>(`/api/gates/${encodeURIComponent(id)}`, { decision, note });

/** Answer an open agent question, unblocking its screen. */
export const answerQuestion = (id: string, answer: string) =>
  postJson<{ status: string }>(`/api/questions/${encodeURIComponent(id)}`, { answer });
