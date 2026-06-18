import { useQuery } from '@tanstack/react-query';
import { fetchWpDetail } from '../api';
import { fmtTokens } from '../lib/board';

/** A screen's drill-down: its attempt timeline + best eval. `null` wpId renders nothing. */
export function WpInspector({ wpId, onClose }: { wpId: string | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['wp', wpId],
    queryFn: () => fetchWpDetail(wpId!),
    enabled: Boolean(wpId),
  });
  if (!wpId) return null;
  return (
    <div className="card p-3" style={{ borderColor: 'var(--accent)' }}>
      <div className="flex items-center justify-between">
        <h3 className="mono font-medium">{data?.screenKey ?? wpId}</h3>
        <button className="btn" onClick={onClose}>
          close
        </button>
      </div>
      {!data ? (
        <p className="muted text-sm">Loading…</p>
      ) : (
        <>
          <div className="muted mb-2 text-xs">
            state {data.state}
            {data.bestEval &&
              ` · best ${data.bestEval.visualPct != null ? `${data.bestEval.visualPct.toFixed(1)}%` : '—'} · ${
                data.bestEval.passed ? 'passed' : 'not passed'
              }`}
          </div>
          {data.attempts.length === 0 ? (
            <p className="muted text-sm">No attempts yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {data.attempts.map((a) => (
                <li key={a.n} className="flex flex-wrap items-center gap-x-2">
                  <span className="muted mono text-xs">#{a.n}</span>
                  <span>{a.role}</span>
                  <span className="muted text-xs">{a.status}</span>
                  <span className="muted text-xs">
                    {fmtTokens(a.inputTokens + a.outputTokens)} tok
                  </span>
                  {a.failureReason && (
                    <span className="text-xs" style={{ color: 'var(--fail)' }}>
                      {a.failureReason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
