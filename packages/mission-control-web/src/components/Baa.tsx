import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  answerQuestion,
  decideGate,
  fetchBaaState,
  stopBaa,
  triggerBaaStage,
  type BaaNodeStatus,
  type BaaStageName,
  type BaaStageNode,
} from '../api';
import { useProject } from '../project';
import { Inbox } from './Inbox';

/** Map a node status to its tone token — pass=green, running=info(blue), stuck=gate(brass). */
function tone(status: BaaNodeStatus): string {
  return status === 'green'
    ? 'var(--pass)'
    : status === 'running'
      ? 'var(--info)'
      : status === 'stuck'
        ? 'var(--gate)'
        : 'var(--border)';
}
function statusWord(status: BaaNodeStatus): string {
  return status === 'green'
    ? 'done'
    : status === 'running'
      ? 'running'
      : status === 'stuck'
        ? 'needs you'
        : 'idle';
}

function StageNode({
  index,
  label,
  sub,
  node,
  startable,
  onStart,
  busy,
}: {
  index: number;
  label: string;
  sub: string;
  node: BaaStageNode;
  startable: boolean;
  onStart: () => void;
  busy: boolean;
}) {
  const t = tone(node.status);
  const active = node.status === 'running';
  const done = node.status === 'green';
  const stuck = node.status === 'stuck';
  const lit = done || active || stuck;
  return (
    <div
      className="flex w-44 shrink-0 flex-col gap-2.5 rounded-[10px] p-3.5"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${lit ? t : 'var(--border)'}`,
        boxShadow: done
          ? `inset 0 0 0 1px color-mix(in srgb, ${t} 50%, transparent), 0 0 22px color-mix(in srgb, ${t} 20%, transparent)`
          : active || stuck
            ? `0 0 22px color-mix(in srgb, ${t} 16%, transparent)`
            : '0 8px 24px rgba(0,0,0,0.25)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {String(index).padStart(2, '0')}
          </span>
          <span
            className="mono text-[13px] font-bold"
            style={{ color: 'var(--text)', letterSpacing: '0.14em' }}
          >
            {label}
          </span>
        </div>
        <span
          className="dot"
          style={{ background: t, boxShadow: node.status !== 'idle' ? `0 0 8px ${t}` : undefined }}
          title={node.status}
          aria-label={node.status}
        />
      </div>
      <span
        className="mono text-[10px]"
        style={{ color: 'var(--text-muted)', letterSpacing: '0.1em' }}
      >
        {sub}
      </span>
      <div className="flex items-center gap-2" style={{ minHeight: 16 }}>
        {active ? <span className="weave-loader" /> : null}
        <span className="muted truncate text-xs">{node.detail || statusWord(node.status)}</span>
      </div>
      {startable ? (
        <button
          className="btn"
          style={{ justifyContent: 'center' }}
          disabled={busy || active}
          onClick={onStart}
        >
          {active ? 'Running…' : done ? 'Re-run' : 'Start'}
        </button>
      ) : (
        <span
          className="pill"
          style={{ justifyContent: 'center', color: 'var(--text-muted)' }}
          title="SHIP is approved from the Inbox below"
        >
          via Inbox
        </span>
      )}
    </div>
  );
}

/** A woven thread connecting two stage nodes — the loom motif as the pipeline edge. */
function Connector() {
  return (
    <div className="flex shrink-0 items-center px-1" style={{ width: 30 }} aria-hidden>
      <div
        style={{
          height: 2,
          width: '100%',
          background:
            'repeating-linear-gradient(to right, var(--border) 0 4px, transparent 4px 7px)',
        }}
      />
    </div>
  );
}

/** The BAA modernization surface: a live node graph of the pipeline stages, each startable, with the
 * gate/question Inbox surfaced inline so stuck states resolve in place. */
export function Baa() {
  const { project } = useProject();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['baa', project],
    queryFn: () => fetchBaaState(project),
    refetchInterval: 2000,
  });
  const runId = data?.run?.id;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['baa'] });

  const stageMut = useMutation({
    mutationFn: (stage: BaaStageName) => triggerBaaStage(stage, runId),
    onSuccess: refresh,
  });
  const stopMut = useMutation({ mutationFn: () => stopBaa(runId), onSuccess: refresh });
  const running = data?.run?.status === 'running';
  const gateMut = useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject' }) => decideGate(v.id, v.decision),
    onSuccess: refresh,
  });
  const answerMut = useMutation({
    mutationFn: (v: { id: string; answer: string }) => answerQuestion(v.id, v.answer),
    onSuccess: refresh,
  });

  const stages = data?.stages;
  // Pipeline order (the real dependency: plan needs the atlas, crawl needs the work packages, build
  // needs the baselines). ship is resolved via the Inbox, not started.
  const nodes: Array<{
    key: BaaStageName | 'ship';
    label: string;
    sub: string;
    startable: boolean;
  }> = [
    { key: 'map', label: 'MAP', sub: 'understand', startable: true },
    { key: 'plan', label: 'PLAN', sub: 'work packages', startable: true },
    { key: 'crawl', label: 'CRAWL', sub: 'capture truth', startable: true },
    { key: 'build', label: 'BUILD', sub: 'eval ↔ fix', startable: true },
    { key: 'ship', label: 'SHIP', sub: 'human gate', startable: false },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
        <div>
          <div className="text-[13px] font-semibold">BAA Modernization</div>
          <div className="muted text-xs">
            Struts → React, stage by stage. EVAL ↔ FIX runs inside BUILD; SHIP is a human gate.
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="muted">run</span>
          <span
            className="pill mono"
            style={{ color: runId ? 'var(--text)' : 'var(--text-muted)' }}
          >
            {runId ?? 'none yet — start MAP'}
          </span>
          {data?.run ? (
            <span
              className="pill mono"
              style={{ color: running ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              {data.run.status}
            </span>
          ) : null}
          {runId ? (
            <button
              className="btn btn-no"
              disabled={stopMut.isPending}
              onClick={() => stopMut.mutate()}
              title="Kill the stage processes and stop the run"
            >
              ■ Halt
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex items-center overflow-auto pb-2">
        {nodes.map((n, i) => (
          <div key={n.key} className="flex items-center">
            <StageNode
              index={i + 1}
              label={n.label}
              sub={n.sub}
              node={stages?.[n.key] ?? { status: 'idle', detail: '' }}
              startable={n.startable}
              busy={stageMut.isPending}
              onStart={() => stageMut.mutate(n.key as BaaStageName)}
            />
            {i < nodes.length - 1 ? <Connector /> : null}
          </div>
        ))}
      </div>

      <section className="card flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Inbox</h2>
          <span className="muted text-xs">— resolve stuck states here</span>
        </div>
        <div className="weave-divider" />
        <Inbox
          gates={data?.gates ?? []}
          questions={data?.questions ?? []}
          onDecideGate={(id, decision) => gateMut.mutate({ id, decision })}
          onAnswerQuestion={(id, answer) => answerMut.mutate({ id, answer })}
        />
      </section>
    </div>
  );
}
