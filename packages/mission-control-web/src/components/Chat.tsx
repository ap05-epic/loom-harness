import { useEffect, useRef, useState } from 'react';
import {
  answerChatPermission,
  createChatSession,
  fetchChatInfo,
  fetchChatSession,
  fetchChatSessions,
  streamChatTurn,
  type ChatInfo,
  type ChatMessageRecord,
  type ChatSessionInfo,
  type PermissionAnswer,
} from '../api';
import { useProject } from '../project';
import { LoomMark } from './LoomMark';

/** One interleaved item produced during a live (streaming) turn. */
type LiveItem =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; running: boolean; ok?: boolean; summary?: string };

type Pending = { turnId: string; requestId: string; name: string; risk: string; input: unknown };

/** Starter prompts for the empty state — the generic-harness capabilities, one click to load. */
const SUGGESTIONS = [
  { title: 'Explore', body: 'Summarize the structure of this project and its main packages.' },
  { title: 'Find work', body: 'Find every TODO and FIXME in the codebase and list them by file.' },
  { title: 'Understand', body: 'Read package.json and explain what each script does.' },
  { title: 'Make a change', body: 'Create a file notes/scratch.md with a short welcome note.' },
];

/** A tool-call card — how a tool start/result renders inline in the chat stream. */
function ToolCard({ name, running, ok, summary }: Omit<LiveItem & { kind: 'tool' }, 'kind'>) {
  const tone = running ? 'var(--info)' : ok === false ? 'var(--fail)' : 'var(--pass)';
  const label = running ? 'running' : ok === false ? 'failed' : 'done';
  return (
    <div
      className="rounded-[8px] p-2.5"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${tone}`,
      }}
    >
      <div className="flex items-center gap-2">
        {running ? (
          <span className="weave-loader" style={{ width: 28 }} />
        ) : (
          <span className="dot" style={{ background: tone, boxShadow: `0 0 6px ${tone}` }} />
        )}
        <span className="mono text-xs" style={{ color: tone }}>
          {label}
        </span>
        <span className="mono text-xs" style={{ color: 'var(--text)' }}>
          {name}
        </span>
      </div>
      {summary ? (
        <pre className="mono muted mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
          {summary.slice(0, 2000)}
        </pre>
      ) : null}
    </div>
  );
}

/** The permission prompt — surfaced in the UI exactly as the terminal's y/N/a/! prompt, gate-lit. */
function PermissionCard({
  pending,
  onAnswer,
}: {
  pending: Pending;
  onAnswer: (a: PermissionAnswer) => void;
}) {
  return (
    <div
      className="rounded-[10px] p-3.5"
      style={{
        background: 'color-mix(in srgb, var(--gate) 7%, var(--surface))',
        border: '1px solid color-mix(in srgb, var(--gate) 45%, var(--border))',
        boxShadow: '0 0 22px color-mix(in srgb, var(--gate) 14%, transparent)',
      }}
    >
      <div className="flex items-center gap-2 text-sm">
        <span
          className="dot"
          style={{ background: 'var(--gate)', boxShadow: '0 0 8px var(--gate)' }}
        />
        Allow <b style={{ color: 'var(--gate)' }}>{pending.name}</b>
        <span className="muted">({pending.risk})</span>?
      </div>
      <pre className="mono muted mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs">
        {JSON.stringify(pending.input, null, 2).slice(0, 1000)}
      </pre>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button className="btn btn-accent" onClick={() => onAnswer('yes')}>
          Yes
        </button>
        <button className="btn btn-no" onClick={() => onAnswer('no')}>
          No
        </button>
        <button className="btn" onClick={() => onAnswer('always')}>
          Always
        </button>
        <button className="btn" onClick={() => onAnswer('all')}>
          Allow all
        </button>
      </div>
    </div>
  );
}

/** A persisted message → a bubble or a tool card. */
function Message({ m }: { m: ChatMessageRecord }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-[10px] px-3.5 py-2 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--accent) 12%, var(--surface-raised))',
            border: '1px solid color-mix(in srgb, var(--accent) 28%, var(--border))',
          }}
        >
          {m.content}
        </div>
      </div>
    );
  }
  if (m.role === 'tool') {
    return (
      <ToolCard name={`tool ${m.toolCallId ?? ''}`} running={false} ok summary={m.content ?? ''} />
    );
  }
  // assistant
  if (m.toolCalls && m.toolCalls.length) {
    return (
      <>
        {m.content ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</div>
        ) : null}
        {m.toolCalls.map((tc) => (
          <ToolCard key={tc.id} name={tc.name} running={false} ok summary={tc.arguments} />
        ))}
      </>
    );
  }
  return <div className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</div>;
}

/** A labelled value in the status bar. */
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="muted text-[11px] tracking-wide uppercase">{label}</span>
      {children}
    </span>
  );
}

export function Chat() {
  const { project } = useProject();
  const [info, setInfo] = useState<ChatInfo | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [live, setLive] = useState<LiveItem[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [compacted, setCompacted] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchChatInfo()
      .then(setInfo)
      .catch(() => setEnabled(false));
  }, []);

  const loadSessions = () =>
    fetchChatSessions(project)
      .then((r) => setSessions(r.sessions))
      .catch(() => setEnabled(false));
  useEffect(() => {
    void loadSessions();
  }, [project]);

  useEffect(() => {
    // Guarded — jsdom (tests) doesn't implement scrollIntoView.
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, live, pending]);

  async function selectSession(id: string) {
    setActiveId(id);
    setLive([]);
    setPending(null);
    setSessionTokens(0);
    setCompacted(false);
    const { messages: msgs } = await fetchChatSession(id);
    setMessages(msgs);
  }

  async function newSession() {
    const s = await createChatSession(project);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setMessages([]);
    setLive([]);
    setPending(null);
    setSessionTokens(0);
    setCompacted(false);
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    let id = activeId;
    if (!id) {
      const s = await createChatSession(project);
      setSessions((prev) => [s, ...prev]);
      id = s.id;
      setActiveId(id);
      setMessages([]);
    }
    setInput('');
    setError(null);
    setBusy(true);
    // optimistic user bubble
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${prev.length}`,
        sessionId: id!,
        seq: prev.length,
        role: 'user',
        content: text,
        toolCalls: null,
        toolCallId: null,
        ts: '',
      },
    ]);
    setLive([]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChatTurn(
        id,
        text,
        (ev) => {
          if (ev.event === 'message') {
            if (ev.data.content)
              setLive((prev) => [...prev, { kind: 'text', text: ev.data.content as string }]);
          } else if (ev.event === 'tool_start') {
            setLive((prev) => [...prev, { kind: 'tool', name: ev.data.name, running: true }]);
          } else if (ev.event === 'tool_done') {
            setLive((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                const it = next[i]!;
                if (it.kind === 'tool' && it.name === ev.data.name && it.running) {
                  next[i] = { ...it, running: false, ok: ev.data.ok, summary: ev.data.summary };
                  break;
                }
              }
              return next;
            });
          } else if (ev.event === 'permission_request') {
            setPending(ev.data);
          } else if (ev.event === 'compacted') {
            setCompacted(true);
          } else if (ev.event === 'done') {
            if (ev.data.usage)
              setSessionTokens((t) => t + ev.data.usage!.inputTokens + ev.data.usage!.outputTokens);
          } else if (ev.event === 'error') {
            setError(ev.data.message);
          }
        },
        controller.signal,
      );
    } catch (e) {
      // An intentional Stop aborts the fetch — that's not an error to surface.
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setBusy(false);
      setPending(null);
      setLive([]);
      // Rehydrate from the persisted truth (and pick up the auto-set title).
      if (id) {
        const { messages: msgs } = await fetchChatSession(id);
        setMessages(msgs);
      }
      void loadSessions();
    }
  }

  async function answerPermission(a: PermissionAnswer) {
    if (!pending) return;
    const p = pending;
    setPending(null);
    await answerChatPermission(p.turnId, p.requestId, a);
  }

  if (!enabled) {
    return (
      <p className="muted text-sm">
        Chat isn’t available — start <span className="mono">loom ui</span> from a configured project
        so the agent has a model + workspace.
      </p>
    );
  }

  const empty = messages.length === 0 && live.length === 0;

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 116px)' }}>
      {/* Sessions sidebar */}
      <aside className="card weave-bg flex w-60 shrink-0 flex-col gap-2 p-2.5">
        <button className="btn btn-accent justify-center" onClick={newSession}>
          + New chat
        </button>
        <div className="weave-divider my-1" />
        <div className="flex flex-col gap-1 overflow-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => selectSession(s.id)}
              className="truncate rounded-md px-2.5 py-1.5 text-left text-sm transition-colors"
              style={{
                color: s.id === activeId ? 'var(--text)' : 'var(--text-muted)',
                background:
                  s.id === activeId
                    ? 'color-mix(in srgb, var(--accent) 10%, var(--surface-raised))'
                    : 'transparent',
                border: `1px solid ${s.id === activeId ? 'color-mix(in srgb, var(--accent) 25%, var(--border))' : 'transparent'}`,
              }}
            >
              {s.title || 'New conversation'}
            </button>
          ))}
          {sessions.length === 0 ? (
            <span className="muted px-2 py-1 text-xs">No conversations yet.</span>
          ) : null}
        </div>
      </aside>

      {/* Conversation */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* Status bar */}
        <div className="card mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3.5 py-2 text-xs">
          <Stat label="model">
            <span className="mono" style={{ color: 'var(--text)' }}>
              {info ? `${info.driver}/${info.model}` : '…'}
            </span>
          </Stat>
          <Stat label="profile">
            <span className="pill mono" style={{ color: 'var(--accent)', padding: '1px 8px' }}>
              {info?.project ?? project ?? '—'}
            </span>
          </Stat>
          <Stat label="tokens">
            <span className="mono">{sessionTokens.toLocaleString()}</span>
          </Stat>
          {compacted ? (
            <span
              className="flex items-center gap-1"
              style={{ color: 'var(--accent)' }}
              title="older turns were summarized to fit the model's context"
            >
              ⟲ compacted
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            {busy ? (
              <>
                <span className="weave-loader" />
                <span style={{ color: 'var(--accent)' }}>streaming</span>
              </>
            ) : (
              <span className="flex items-center gap-1.5 muted">
                <span className="dot" style={{ background: 'var(--pass)' }} /> ready
              </span>
            )}
          </span>
        </div>

        {/* Transcript */}
        <div className="flex flex-1 flex-col gap-2.5 overflow-auto pr-1">
          {empty ? (
            <div className="reveal flex flex-1 flex-col items-center justify-center gap-5 px-4 text-center">
              <div style={{ color: 'var(--text)', opacity: 0.9 }}>
                <LoomMark size={48} />
              </div>
              <div>
                <div className="text-lg font-semibold">Ask the harness anything</div>
                <p className="muted mx-auto mt-1 max-w-md text-sm">
                  It can read &amp; edit files, run commands, remember facts, and operate the
                  pipeline. Expensive actions ask first.
                </p>
              </div>
              <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.title}
                    onClick={() => setInput(s.body)}
                    className="card-raised p-3 text-left transition-colors hover:border-[var(--accent)]"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div
                      className="mono text-[11px] tracking-wide uppercase"
                      style={{ color: 'var(--accent)' }}
                    >
                      {s.title}
                    </div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--text)' }}>
                      {s.body}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((m) => (
            <Message key={m.id} m={m} />
          ))}
          {live.map((it, i) =>
            it.kind === 'text' ? (
              <div key={i} className="text-sm leading-relaxed whitespace-pre-wrap">
                {it.text}
              </div>
            ) : (
              <ToolCard
                key={i}
                name={it.name}
                running={it.running}
                ok={it.ok}
                summary={it.summary}
              />
            ),
          )}
          {pending ? <PermissionCard pending={pending} onAnswer={answerPermission} /> : null}
          {error ? (
            <div
              className="rounded-[8px] p-2.5 text-sm"
              style={{
                color: 'var(--fail)',
                background: 'color-mix(in srgb, var(--fail) 8%, var(--surface))',
                border: '1px solid color-mix(in srgb, var(--fail) 35%, var(--border))',
              }}
            >
              {error}
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="mt-3 flex gap-2">
          <input
            className="field flex-1"
            placeholder={busy ? 'streaming…' : 'Message the harness…'}
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <button
              className="btn btn-no"
              onClick={() => abortRef.current?.abort()}
              title="Stop this turn"
            >
              ■ Stop
            </button>
          ) : (
            <button className="btn btn-accent" onClick={() => void send()}>
              Send
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
