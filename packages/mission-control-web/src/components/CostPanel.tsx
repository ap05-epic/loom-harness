import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { DashboardState } from '../api';
import { fmtTokens } from '../lib/board';

/** Cost view: total tokens + a per-model bar chart and breakdown. */
export function CostPanel({ cost, costByModel }: Pick<DashboardState, 'cost' | 'costByModel'>) {
  const total = cost.inputTokens + cost.outputTokens;
  return (
    <section className="card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-medium">Cost</h3>
        <span className="muted text-xs">
          <span style={{ color: 'var(--text)' }}>{fmtTokens(total)}</span> tokens · {cost.spans}{' '}
          spans
        </span>
      </div>
      {costByModel.length === 0 ? (
        <p className="muted text-sm">No cost yet.</p>
      ) : (
        <>
          <div style={{ height: 120 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costByModel} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <XAxis dataKey="model" tick={false} axisLine={false} />
                <YAxis hide />
                <Bar dataKey="tokens" fill="var(--accent)" radius={3} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {costByModel.map((m) => (
              <li key={m.model} className="flex justify-between">
                <span className="mono">{m.model}</span>
                <span className="muted">
                  {fmtTokens(m.tokens)} · {m.attempts} att
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
