import { useQuery } from '@tanstack/react-query';
import { fetchState } from '../api';
import { KanbanBoard } from './KanbanBoard';
import { RunHeader } from './RunHeader';

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

/** The main dashboard: polls /api/state every 2s and renders the run header + kanban board. */
export function Dashboard() {
  const { data, isError, isFetching } = useQuery({
    queryKey: ['state'],
    queryFn: () => fetchState(),
    refetchInterval: 2000,
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <RunHeader run={data?.run ?? null} />
        </div>
        <LiveIndicator isError={isError} isFetching={isFetching} hasData={Boolean(data)} />
      </div>
      <KanbanBoard screens={data?.screens ?? []} />
    </div>
  );
}
