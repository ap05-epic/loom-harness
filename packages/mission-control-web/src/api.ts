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

// ---- BAA modernization surface (the stage graph) ----

export type BaaNodeStatus = 'idle' | 'running' | 'green' | 'stuck';
export type BaaStageNode = { status: BaaNodeStatus; detail: string };
export type BaaStageName = 'map' | 'plan' | 'crawl' | 'build';
export type BaaState = {
  run: { id: string; project: string; status: string; stage: string | null } | null;
  stages: {
    map: BaaStageNode;
    plan: BaaStageNode;
    crawl: BaaStageNode;
    build: BaaStageNode;
    ship: BaaStageNode;
  };
  gates: Gate[];
  questions: Question[];
};

export const fetchBaaState = (project?: string, run?: string): Promise<BaaState> => {
  const params = new URLSearchParams();
  if (project) params.set('project', project);
  if (run) params.set('run', run);
  const qstr = params.toString();
  return getJson<BaaState>(`/api/baa-state${qstr ? `?${qstr}` : ''}`);
};

/** Trigger one stage — the server spawns a detached `loom stage` child against the run. */
export const triggerBaaStage = (stage: BaaStageName, runId?: string) =>
  postJson<{ started: boolean; pid: number | null }>('/api/baa/stage', {
    stage,
    ...(runId ? { runId } : {}),
  });

/** Halt — the kill switch. Terminates spawned stage processes + stops the run (blocks its WPs). */
export const stopBaa = (runId?: string) =>
  postJson<{ killed: number; runId: string | null; halted: number }>(
    '/api/baa/stop',
    runId ? { runId } : {},
  );

/** Answer an open agent question, unblocking its screen. */
export const answerQuestion = (id: string, answer: string) =>
  postJson<{ status: string }>(`/api/questions/${encodeURIComponent(id)}`, { answer });

// ---- Generic Chat surface ----

/** The chat surface's standing context (for the status bar). */
export type ChatInfo = { model: string; project: string; profile: string; driver: string };
export const fetchChatInfo = (): Promise<ChatInfo> => getJson<ChatInfo>('/api/chat/info');

/** A switchable profile learning-root (the Hermes `HERMES_HOME` analog). */
export type ProfileSummary = { name: string; active: boolean; configured: boolean; skills: number };
export type ProfilesResponse = { active: string; configured: string; profiles: ProfileSummary[] };
export const fetchProfiles = (): Promise<ProfilesResponse> =>
  getJson<ProfilesResponse>('/api/profiles');
/** Switch the active profile (no restart) — reloads profile-tier memory + skills for new turns. */
export const switchProfile = (name: string): Promise<{ active: string }> =>
  postJson<{ active: string }>('/api/profiles/active', { name });

export type ChatSessionInfo = {
  id: string;
  project: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ChatMessageRecord = {
  id: string;
  sessionId: string;
  seq: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }> | null;
  toolCallId: string | null;
  ts: string;
};

export const fetchChatSessions = (project?: string): Promise<{ sessions: ChatSessionInfo[] }> =>
  getJson<{ sessions: ChatSessionInfo[] }>(`/api/chat/sessions${q(project)}`);

export const createChatSession = (project?: string): Promise<ChatSessionInfo> =>
  postJson<ChatSessionInfo>('/api/chat/sessions', project ? { project } : {});

export const fetchChatSession = (
  id: string,
): Promise<{ session: ChatSessionInfo; messages: ChatMessageRecord[] }> =>
  getJson<{ session: ChatSessionInfo; messages: ChatMessageRecord[] }>(
    `/api/chat/sessions/${encodeURIComponent(id)}`,
  );

export type PermissionAnswer = 'yes' | 'no' | 'always' | 'all';
export const answerChatPermission = (turnId: string, requestId: string, answer: PermissionAnswer) =>
  postJson<{ ok: boolean }>(`/api/chat/turns/${encodeURIComponent(turnId)}/permission`, {
    requestId,
    answer,
  });

/** A parsed SSE event from a chat turn — mirrors the server's event types. */
export type ChatStreamEvent =
  | { event: 'message'; data: { content: string | null; toolCalls?: unknown } }
  | { event: 'tool_start'; data: { name: string } }
  | { event: 'tool_done'; data: { name: string; ok?: boolean; summary?: string } }
  | {
      event: 'permission_request';
      data: { turnId: string; requestId: string; name: string; risk: string; input: unknown };
    }
  | { event: 'compacted'; data: { keptLast: number } }
  | {
      event: 'done';
      data: { finalText: string | null; usage?: { inputTokens: number; outputTokens: number } };
    }
  | { event: 'error'; data: { message: string } };

/**
 * Drive one chat turn and surface its SSE events to `onEvent`. POST (with the user input) returns a
 * server-sent-event stream; we read it incrementally so tool-call cards, assistant text, and the
 * permission prompt appear live. EventSource can't POST, so we read the fetch body stream directly.
 */
export async function streamChatTurn(
  sessionId: string,
  input: string,
  onEvent: (ev: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`turn → ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = '';
      let dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
      }
      if (!event) continue;
      onEvent({ event, data: dataStr ? JSON.parse(dataStr) : {} } as ChatStreamEvent);
    }
  }
}
