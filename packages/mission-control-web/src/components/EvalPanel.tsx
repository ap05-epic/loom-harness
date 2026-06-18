import type { DashboardState } from '../api';

/** Evaluation analytics: pass rate over evaluated screens + the failure-reason Pareto. */
export function EvalPanel({ analytics }: { analytics: DashboardState['evalAnalytics'] }) {
  const pct = Math.round(analytics.passRate * 100);
  return (
    <section className="card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-medium">Evaluation</h3>
        {analytics.evaluated > 0 && (
          <span className="text-sm">
            <span style={{ color: 'var(--pass)' }}>{pct}%</span>{' '}
            <span className="muted">
              pass ({analytics.passed}/{analytics.evaluated})
            </span>
          </span>
        )}
      </div>
      {analytics.evaluated === 0 ? (
        <p className="muted text-sm">No evaluations yet.</p>
      ) : analytics.failureReasons.length === 0 ? (
        <p className="muted text-sm">No failures recorded — every evaluated screen passed.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {analytics.failureReasons.map((r) => (
            <li key={r.reason} className="flex justify-between">
              <span>{r.reason}</span>
              <span className="muted">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
