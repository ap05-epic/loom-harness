import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { answerQuestion, decideGate, fetchState, stopBaa } from '../api';
import { useProject } from '../project';
import { CostPanel } from './CostPanel';
import { EvalPanel } from './EvalPanel';
import { Inbox } from './Inbox';
import { InventoryPanel } from './InventoryPanel';
import { KanbanBoard } from './KanbanBoard';
import { LiveFleet } from './LiveFleet';
import { RunHeader } from './RunHeader';
import { WpInspector } from './WpInspector';

/** A live status pill — so the operator always knows the dashboard is connected and fresh, never a blind spinner. */
function LiveIndicator({
  isError,
  isFetching,
  hasData,
}: {
  isError: boolean;
  isFetching: boolean;
  hasData: boolean;
}) {
  const [color, label] = isError
    ? ['var(--fail)', 'offline']
    : !hasData
      ? ['var(--text-muted)', 'connecting…']
      : isFetching
        ? ['var(--info)', 'refreshing']
        : ['var(--pass)', 'live'];
  return (
    <div className="flex items-center gap-2 whitespace-nowrap text-sm" title="polling every 2s">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span className="muted">{label}</span>
    </div>
  );
}

/** A titled section wrapper. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-3">
      <h3 className="mb-2 font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** The main dashboard: polls /api/state every 2s and renders the rebuild board, fleet, inbox, cost/eval, and capabilities. */
export function Dashboard() {
  const qc = useQueryClient();
  const { project } = useProject();
  const [selectedWp, setSelectedWp] = useState<string | null>(null);
  const { data, isError, isFetching } = useQuery({
    queryKey: ['state', project],
    queryFn: () => fetchState(project),
    refetchInterval: 2000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['state'] });
  const gateMut = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      decideGate(id, decision),
    onSuccess: refresh,
  });
  const answerMut = useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: string }) => answerQuestion(id, answer),
    onSuccess: refresh,
  });
  const stopMut = useMutation({ mutationFn: () => stopBaa(data?.run?.id), onSuccess: refresh });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <RunHeader run={data?.run ?? null} />
        </div>
        {data?.run?.status === 'running' ? (
          <button
            className="btn btn-no"
            disabled={stopMut.isPending}
            onClick={() => stopMut.mutate()}
            title="Halt the run — stop all workers and their token use"
          >
            ■ Halt
          </button>
        ) : null}
        <LiveIndicator isError={isError} isFetching={isFetching} hasData={Boolean(data)} />
      </div>

      <KanbanBoard screens={data?.screens ?? []} onSelect={setSelectedWp} />

      {selectedWp && <WpInspector wpId={selectedWp} onClose={() => setSelectedWp(null)} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel title="Live fleet">
            <LiveFleet workers={data?.liveNow ?? []} onSelect={setSelectedWp} />
          </Panel>
          <Panel title="Inbox">
            <Inbox
              gates={data?.gates ?? []}
              questions={data?.questions ?? []}
              onDecideGate={(id, decision) => gateMut.mutate({ id, decision })}
              onAnswerQuestion={(id, answer) => answerMut.mutate({ id, answer })}
            />
          </Panel>
        </div>
        <div className="flex flex-col gap-4">
          <CostPanel
            cost={data?.cost ?? { inputTokens: 0, outputTokens: 0, totalDurationMs: 0, spans: 0 }}
            costByModel={data?.costByModel ?? []}
          />
          <EvalPanel
            analytics={
              data?.evalAnalytics ?? { evaluated: 0, passed: 0, passRate: 0, failureReasons: [] }
            }
          />
        </div>
      </div>

      <InventoryPanel />
    </div>
  );
}
