import { readdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { ChatMessage, LlmGateway, ToolCall } from '@loom/agents';
import {
  agenticChatTurn,
  buildChatTools,
  CHAT_SYSTEM_PROMPT,
  packRecall,
  type ChatSession as ChatToolContext,
} from '@loom/chat';
import {
  ChatStore,
  newId,
  ProfileStore,
  profilePaths,
  type ChatMessageInput,
  type ChatMessageRecord,
  type Profile,
  type SqliteDatabase,
} from '@loom/core';
import {
  createPolicy,
  type PermissionAnswer,
  type PermissionPolicy,
  type PermissionPrompt,
} from '@loom/tools';

/**
 * Everything the server needs to drive the **same** agent loop the CLI uses (the extracted
 * `agenticChatTurn`), for the browser Generic Chat surface. Supplied by the CLI's `loom ui` command
 * when a profile is configured; absent → the chat endpoints report 503 and the dashboard still runs.
 */
export type ChatRuntime = {
  gateway: LlmGateway;
  model: string;
  profile: Profile;
  /** The directory the file/exec tools are confined to (the project the user launched `loom ui` in). */
  root: string;
  version: string;
  docsDir?: string;
  /** The profile learning root — recall merges its facts; `memory_remember scope:profile` writes it. */
  profileStore?: ProfileStore;
  /** The Loom home (`~/.loom`) whose `profiles/` dir holds every switchable profile root. */
  homeDir?: string;
  /**
   * Auto-compaction trigger: once a session's cumulative tokens reach this, the older turns are
   * summarized into one message so the conversation never overflows the model's context (default
   * 150k). The recent turns are kept intact.
   */
  compactTokenTrigger?: number;
};

/**
 * The active profile override — switched at runtime from the UI (no restart), à la Hermes. `null`
 * means "use the runtime's configured profile". Swapping it reloads the profile-tier memory + skills
 * for subsequent chat turns; the project tier (per-project loom.db) is untouched.
 */
let switchedProfile: { name: string; store: ProfileStore } | null = null;

/** The configured (default) profile name for the runtime. */
function configuredProfile(rt: ChatRuntime): string {
  return rt.profile.profile ?? rt.profile.project;
}
/** The profile whose memory + skills the chat currently recalls (override, else configured). */
function activeProfileName(rt: ChatRuntime): string {
  return switchedProfile?.name ?? configuredProfile(rt);
}
/** The profile store the chat currently recalls from (the override's, else the runtime's). */
function activeStore(rt: ChatRuntime): ProfileStore | undefined {
  return switchedProfile?.store ?? rt.profileStore;
}
/** Count a profile's accumulated skills cheaply (sub-dirs of its skills/ dir). */
function profileSkillCount(homeDir: string, name: string): number {
  try {
    return readdirSync(profilePaths(homeDir, name).skillsDir, { withFileTypes: true }).filter((d) =>
      d.isDirectory(),
    ).length;
  } catch {
    return 0;
  }
}

/** How long a suspended permission prompt waits for the user before defaulting to "no". */
const PERMISSION_TIMEOUT_MS = 5 * 60_000;

/** A suspended permission prompt, keyed by request id, awaiting an out-of-band decision POST. */
type Pending = { resolve: (a: PermissionAnswer) => void; turnId: string };
const pending = new Map<string, Pending>();
/** Sessions with a turn currently streaming — guards against two tabs interleaving one session. */
const activeTurns = new Set<string>();
/** Per-session permission policy, so an "always"/"all" choice persists across the session's turns. */
const sessionPolicies = new Map<string, PermissionPolicy>();
/** Per-session cumulative tokens, for the auto-compaction trigger. */
const sessionTokens = new Map<string, number>();

const DEFAULT_COMPACT_TRIGGER = 150_000;
/** How many recent messages a compaction keeps intact (the rest become one summary). */
const COMPACT_KEEP_LAST = 6;

/** Summarize the older turns into one message (the condenser behind auto-compaction). */
async function summarizeHistory(rt: ChatRuntime, messages: ChatMessage[]): Promise<string> {
  const res = await rt.gateway.complete({
    model: rt.model,
    messages: [
      {
        role: 'system',
        content:
          'Summarize the conversation so far in a few sentences, preserving decisions made, facts ' +
          'learned, files changed, and open threads. This summary replaces the older turns verbatim.',
      },
      ...messages,
    ],
    maxTokens: 600,
  });
  return `## Earlier conversation (summarized)\n${(res.content ?? '').trim() || '(no summary)'}`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A persisted message → the provider-agnostic `ChatMessage` the agent loop replays. */
function toChatMessage(r: ChatMessageRecord): ChatMessage {
  if (r.role === 'assistant')
    return {
      role: 'assistant',
      content: r.content,
      toolCalls: (r.toolCalls as ToolCall[]) ?? undefined,
    };
  if (r.role === 'tool')
    return { role: 'tool', toolCallId: r.toolCallId ?? '', content: r.content ?? '' };
  return { role: r.role, content: r.content ?? '' };
}

/** A `ChatMessage` produced this turn → the persistence input for {@link ChatStore.appendMessages}. */
function toInput(m: ChatMessage): ChatMessageInput {
  if (m.role === 'assistant')
    return { role: 'assistant', content: m.content, toolCalls: m.toolCalls };
  if (m.role === 'tool') return { role: 'tool', toolCallId: m.toolCallId, content: m.content };
  return { role: m.role, content: m.content };
}

/** Run one browser-chat turn as an SSE stream, with in-UI permission prompts + durable persistence. */
async function streamTurn(
  rt: ChatRuntime,
  db: SqliteDatabase,
  sessionId: string,
  input: string,
  res: ServerResponse,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    // Disable proxy buffering so events flush immediately.
    'x-accel-buffering': 'no',
  });
  const send = (event: string, data: unknown): void => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* socket gone */
    }
  };

  const store = new ChatStore(db);
  const session = store.getSession(sessionId);
  if (!session) {
    send('error', { message: 'session not found' });
    res.end();
    return;
  }
  if (activeTurns.has(sessionId)) {
    send('error', { message: 'a turn is already in progress for this session' });
    res.end();
    return;
  }
  activeTurns.add(sessionId);
  const turnId = newId('turn');
  const cancel = new AbortController();
  const settleTurnPermissions = (): void => {
    for (const [, e] of pending) if (e.turnId === turnId) e.resolve('no');
  };
  // A client disconnect (the Stop button aborts the fetch) cancels the agent loop — no more tokens —
  // and settles any waiting permission prompt as "no".
  res.on('close', () => {
    cancel.abort();
    settleTurnPermissions();
  });

  try {
    // The conversation so far (no system message — that's prepended fresh each turn for cache stability).
    const prior = store.listMessages(sessionId).map(toChatMessage);
    if (!session.title) store.setTitle(sessionId, input.slice(0, 80));
    // Persist the user message up-front so a crash mid-turn still shows what was asked.
    store.appendMessages(sessionId, [{ role: 'user', content: input }]);

    const history: ChatMessage[] = [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, ...prior];
    const recall = packRecall(db, rt.profile.project, input, { profile: activeStore(rt) });

    const policy = sessionPolicies.get(sessionId) ?? createPolicy('ask');
    sessionPolicies.set(sessionId, policy);

    const toolCtx: ChatToolContext = {
      db,
      gateway: rt.gateway,
      profile: rt.profile,
      version: rt.version,
      root: rt.root,
      docsDir: rt.docsDir,
      profileStore: activeStore(rt),
    };
    // The browser toolset deliberately omits the pipeline-executing tools (map/run/resume): the
    // server must never drive a pipeline inline (it would break single-writer + hold the socket).
    const tools = buildChatTools(toolCtx);

    const prompt: PermissionPrompt = (req) =>
      new Promise<PermissionAnswer>((resolve) => {
        if (cancel.signal.aborted) return resolve('no');
        const requestId = newId('perm');
        const settle = (a: PermissionAnswer): void => {
          if (!pending.has(requestId)) return;
          clearTimeout(timer);
          pending.delete(requestId);
          resolve(a);
        };
        const timer = setTimeout(() => settle('no'), PERMISSION_TIMEOUT_MS);
        pending.set(requestId, { resolve: settle, turnId });
        send('permission_request', {
          turnId,
          requestId,
          name: req.name,
          risk: req.risk,
          input: req.input,
        });
      });

    const result = await agenticChatTurn(rt.gateway, {
      model: rt.model,
      history,
      input,
      recall,
      tools,
      policy,
      prompt,
      onTool: (e) =>
        send(e.phase === 'start' ? 'tool_start' : 'tool_done', {
          name: e.name,
          ok: e.ok,
          summary: e.summary,
        }),
      onMessage: (m) => {
        if (m.role === 'assistant') send('message', { content: m.content, toolCalls: m.toolCalls });
      },
      signal: cancel.signal,
    });

    // Persist only the new tail (assistant/tool). Skip system + recall + the user message (already saved).
    const sent = history.length + (recall ? 1 : 0) + 1;
    const tail = result.history.slice(sent).map(toInput);
    if (tail.length) store.appendMessages(sessionId, tail);

    // Auto-compaction (emitted before `done` so the client sees it): once the session's cumulative
    // spend crosses the trigger, condense the older turns into one summary so the conversation never
    // overflows the model's context window.
    const trigger = rt.compactTokenTrigger ?? DEFAULT_COMPACT_TRIGGER;
    const total =
      (sessionTokens.get(sessionId) ?? 0) + result.usage.inputTokens + result.usage.outputTokens;
    sessionTokens.set(sessionId, total);
    if (total >= trigger) {
      const all = store.listMessages(sessionId);
      if (all.length > COMPACT_KEEP_LAST) {
        try {
          const older = all.slice(0, -COMPACT_KEEP_LAST).map(toChatMessage);
          store.compact(sessionId, COMPACT_KEEP_LAST, await summarizeHistory(rt, older));
          sessionTokens.set(sessionId, 0);
          send('compacted', { keptLast: COMPACT_KEEP_LAST });
        } catch {
          /* compaction is best-effort — a failed summarize must never break the turn */
        }
      }
    }

    send('done', { finalText: result.finalText, usage: result.usage });
  } catch (error) {
    send('error', { message: error instanceof Error ? error.message : String(error) });
  } finally {
    activeTurns.delete(sessionId);
    res.end();
  }
}

/**
 * Handle the `/api/chat/*` routes (the browser Generic Chat surface). Returns true when it handled the
 * request, false to let the main router try the next route. When chat isn't enabled (no profile at
 * `loom ui`), the chat routes answer 503 — the rest of Mission Control is unaffected.
 */
export async function handleChatRequest(
  opts: { db: SqliteDatabase; chat?: ChatRuntime; project?: string },
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  const { pathname } = url;
  if (!pathname.startsWith('/api/chat') && !pathname.startsWith('/api/profiles')) return false;
  const rt = opts.chat;
  if (!rt) {
    sendJson(res, 503, {
      error: 'chat is not enabled — start `loom ui` from a configured project',
    });
    return true;
  }
  const db = opts.db;
  const store = new ChatStore(db);
  const defaultProject = rt.profile.project;

  // The chat surface's standing context for the status bar (model / profile / driver).
  if (method === 'GET' && pathname === '/api/chat/info') {
    sendJson(res, 200, {
      model: rt.model,
      project: rt.profile.project,
      profile: activeProfileName(rt),
      driver: rt.profile.llm.driver,
    });
    return true;
  }

  // ── Profiles (the Hermes-style learning-root switcher) ─────────────────────
  // List every switchable profile under ~/.loom/profiles, with the active one + its skill count.
  if (method === 'GET' && pathname === '/api/profiles') {
    const active = activeProfileName(rt);
    const names = new Set<string>([configuredProfile(rt), active]);
    if (rt.homeDir) {
      try {
        for (const d of readdirSync(join(rt.homeDir, 'profiles'), { withFileTypes: true }))
          if (d.isDirectory()) names.add(d.name);
      } catch {
        /* no profiles dir yet — just the configured one */
      }
    }
    const profiles = [...names].sort().map((name) => ({
      name,
      active: name === active,
      configured: name === configuredProfile(rt),
      skills: rt.homeDir ? profileSkillCount(rt.homeDir, name) : 0,
    }));
    sendJson(res, 200, { active, configured: configuredProfile(rt), profiles });
    return true;
  }

  // Switch the active profile (no restart) — swaps the profile-tier memory + skills for new turns.
  if (method === 'POST' && pathname === '/api/profiles/active') {
    const body = await readJson(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return (sendJson(res, 400, { error: 'name is required' }), true);
    if (name === configuredProfile(rt)) {
      // Back to the configured profile — drop the override.
      if (switchedProfile) {
        try {
          switchedProfile.store.close();
        } catch {
          /* already closed */
        }
        switchedProfile = null;
      }
    } else if (switchedProfile?.name !== name) {
      if (!rt.homeDir) return (sendJson(res, 503, { error: 'profile root not available' }), true);
      if (switchedProfile) {
        try {
          switchedProfile.store.close();
        } catch {
          /* already closed */
        }
      }
      switchedProfile = { name, store: new ProfileStore(rt.homeDir, name) };
    }
    sendJson(res, 200, { active: activeProfileName(rt) });
    return true;
  }

  if (method === 'POST' && pathname === '/api/chat/sessions') {
    const body = await readJson(req);
    const project =
      typeof body.project === 'string' && body.project ? body.project : defaultProject;
    const title = typeof body.title === 'string' ? body.title : undefined;
    sendJson(res, 200, store.createSession({ project, ...(title ? { title } : {}) }));
    return true;
  }

  if (method === 'GET' && pathname === '/api/chat/sessions') {
    const project = url.searchParams.get('project') ?? defaultProject;
    sendJson(res, 200, { sessions: store.listSessions(project) });
    return true;
  }

  const sessMatch = pathname.match(/^\/api\/chat\/sessions\/([^/]+)$/);
  if (method === 'GET' && sessMatch) {
    const session = store.getSession(sessMatch[1]!);
    if (!session) return (sendJson(res, 404, { error: 'session not found' }), true);
    sendJson(res, 200, { session, messages: store.listMessages(sessMatch[1]!) });
    return true;
  }

  const turnMatch = pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/turn$/);
  if (method === 'POST' && turnMatch) {
    const body = await readJson(req);
    const input = typeof body.input === 'string' ? body.input.trim() : '';
    if (!input) return (sendJson(res, 400, { error: 'input is required' }), true);
    await streamTurn(rt, db, turnMatch[1]!, input, res);
    return true;
  }

  const permMatch = pathname.match(/^\/api\/chat\/turns\/([^/]+)\/permission$/);
  if (method === 'POST' && permMatch) {
    const body = await readJson(req);
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const answer = body.answer;
    const valid: PermissionAnswer[] = ['yes', 'no', 'always', 'all'];
    if (!valid.includes(answer as PermissionAnswer)) {
      return (sendJson(res, 400, { error: 'answer must be yes | no | always | all' }), true);
    }
    const entry = pending.get(requestId);
    if (!entry)
      return (sendJson(res, 409, { error: 'no pending permission for that request' }), true);
    entry.resolve(answer as PermissionAnswer);
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 404, { error: 'unknown chat route' });
  return true;
}
