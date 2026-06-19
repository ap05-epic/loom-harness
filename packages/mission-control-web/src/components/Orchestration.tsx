import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchState, stopBaa, type LiveWorker } from '../api';
import { useProject } from '../project';
import { LoomMark } from './LoomMark';

/** A coarse "how long ago" from an ISO timestamp (browser clock — fine for a live feed). */
function ago(ts: string | null): string {
  if (!ts) return '';
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function timeOf(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

const STATE_TONE: Record<string, string> = {
  building: 'var(--info)',
  evaluating: 'var(--info)',
  fixing: 'var(--info)',
  planned: 'var(--accent)',
  passed: 'var(--pass)',
  shipped: 'var(--pass)',
  blocked: 'var(--gate)',
  needs_human: 'var(--gate)',
  failed: 'var(--fail)',
};
function stateTone(state: string): string {
  return STATE_TONE[state] ?? 'var(--text-muted)';
}

/** Colour a raw event type by what it means (pass/fail/attention/info). */
function eventTone(type: string): string {
  const t = type.toLowerCase();
  if (/(fail|error|blocked|stopped|guard)/.test(t)) return 'var(--fail)';
  if (/(pass|ship|finished|completed|green|captured|created)/.test(t)) return 'var(--pass)';
  if (/(gate|question|human|deviation)/.test(t)) return 'var(--gate)';
  return 'var(--info)';
}

/** One spawned worker (a subagent) — its screen, phase, attempt, spend, and last action, live. */
function WorkerCard({ w }: { w: LiveWorker }) {
  const t = stateTone(w.state);
  return (
    <div className="card-raised flex flex-col gap-2 p-3.5" style={{ borderLeft: `3px solid ${t}` }}>
      <div className="flex items-center justify-between gap-2">
        <span className="mono truncate text-sm font-medium">{w.screenKey ?? w.wpId}</span>
        <span className="pill" style={{ color: t, borderColor: t, fontSize: 11 }}>
          <span className="dot" style={{ background: t, boxShadow: `0 0 6px ${t}` }} />
          {w.state}
        </span>
      </div>
      <div className="muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          attempt{' '}
          <span className="mono" style={{ color: 'var(--text)' }}>
            #{w.attempt}
          </span>
        </span>
        <span>
          tokens{' '}
          <span className="mono" style={{ color: 'var(--text)' }}>
            {w.tokens.toLocaleString()}
          </span>
        </span>
        {w.startedAt ? (
          <span>
            running{' '}
            <span className="mono" style={{ color: 'var(--text)' }}>
              {ago(w.startedAt)}
            </span>
          </span>
        ) : null}
      </div>
      {w.lastEvent ? (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="weave-loader" style={{ width: 24 }} />
          <span className="mono truncate" style={{ color: 'var(--text)' }}>
            {w.lastEvent}
          </span>
          {w.lastEventTs ? <span className="muted">· {ago(w.lastEventTs)} ago</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The live orchestration view: the orchestrator (conductor) at the top, the workers (subagents) it
 * has summoned below — each streaming its phase + last action — and a live event feed, so a human is
 * always in the know about what the agents are doing. */
export function Orchestration() {
  const { project } = useProject();
  const { data, isFetching, isError } = useQuery({
    queryKey: ['state', project],
    queryFn: () => fetchState(project),
    refetchInterval: 1500,
  });
  const qc = useQueryClient();
  const stop = useMutation({
    mutationFn: () => stopBaa(data?.run?.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });
  const run = data?.run ?? null;
  const workers = data?.liveNow ?? [];
  const events = [...(data?.recent ?? [])].reverse(); // server returns oldest→newest; show newest first
  const active = workers.length > 0;
  const haltable = active || run?.status === 'running';
  const counts = Object.entries(data?.counts ?? {}).filter(([, n]) => n > 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Orchestrator node */}
      <div className="card p-5">
        <div className="flex items-center gap-4">
          <div
            className={`relative flex h-12 w-12 items-center justify-center rounded-[12px] ${active ? 'pulse-ring' : ''}`}
            style={{
              background: active ? 'var(--accent-soft)' : 'var(--surface-raised)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              color: 'var(--text)',
            }}
          >
            <LoomMark size={24} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">
              Orchestrator
              {run?.stage ? <span className="muted"> · {run.stage}</span> : null}
            </div>
            <div className="muted text-xs">
              {active
                ? `summoning ${workers.length} worker${workers.length === 1 ? '' : 's'} — live`
                : run
                  ? 'idle — no workers running right now'
                  : 'no active run — start one with loom run, or the BAA BUILD stage'}
            </div>
          </div>
          {active ? <span className="weave-loader" /> : null}
          {haltable ? (
            <button
              className="btn btn-no"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
              title="Kill all workers and stop the run"
            >
              ■ Halt
            </button>
          ) : null}
          <span
            className="flex items-center gap-1.5 text-xs whitespace-nowrap"
            title="polling every 1.5s"
          >
            <span
              className="dot"
              style={{
                background: isError ? 'var(--fail)' : isFetching ? 'var(--info)' : 'var(--pass)',
              }}
            />
            <span className="muted">{isError ? 'offline' : 'live'}</span>
          </span>
        </div>
        {counts.length ? (
          <>
            <div className="weave-divider my-3" />
            <div className="flex flex-wrap gap-2">
              {counts.map(([k, n]) => (
                <span key={k} className="pill" style={{ fontSize: 11 }}>
                  {k.replace(/_/g, ' ')}{' '}
                  <span className="mono" style={{ color: 'var(--text)' }}>
                    {n}
                  </span>
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* Subagents (the spawned workers) */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold">Subagents</h3>
          <span className="muted text-xs">{workers.length} running</span>
        </div>
        {workers.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workers.map((w) => (
              <WorkerCard key={w.wpId} w={w} />
            ))}
          </div>
        ) : (
          <div className="card p-8 text-center">
            <p className="muted mx-auto max-w-md text-sm">
              No subagents running right now. When the orchestrator builds screens, each worker
              appears here live — its phase, attempt, token spend, and last action.
            </p>
          </div>
        )}
      </div>

      {/* Live activity feed */}
      <div className="card p-4">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold">Live activity</h3>
          <span className="muted text-xs">newest first</span>
        </div>
        <div className="weave-divider mb-2" />
        {events.length ? (
          <div className="flex max-h-80 flex-col gap-1 overflow-auto pr-1">
            {events.map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-0.5 text-xs">
                <span className="mono muted" style={{ minWidth: 76 }}>
                  {timeOf(e.ts)}
                </span>
                <span className="dot" style={{ background: eventTone(e.type) }} />
                <span className="mono" style={{ color: 'var(--text)' }}>
                  {e.type}
                </span>
                {e.wpId ? <span className="muted mono">{e.wpId}</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted text-sm">No activity yet — the feed fills as the agents work.</p>
        )}
      </div>
    </div>
  );
}
