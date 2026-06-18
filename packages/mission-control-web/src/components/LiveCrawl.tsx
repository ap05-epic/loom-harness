import type { ReactNode } from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { exploreShotUrl, type ExploreState } from '../api';
import { fmtTokens } from '../lib/board';
import type { TokenSample } from '../lib/series';

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="muted text-xs uppercase tracking-wide">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

/** The headline Live Crawl view: where the explorer is right now, its moves, discovered screens, and the token burn. */
export function LiveCrawl({
  state,
  series,
}: {
  state: ExploreState | null;
  series: TokenSample[];
}) {
  if (!state || !state.run) {
    return (
      <p className="muted text-sm">
        No crawl running — run <code className="mono">loom explore</code> to map an app live.
      </p>
    );
  }
  const t = state.totals;
  return (
    <div className="flex flex-col gap-4">
      <div className="card p-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: t.done ? 'var(--pass)' : 'var(--info)' }}
          />
          <span className="muted text-xs">
            {t.done ? 'done' : 'live'} · {state.current.lastAction ?? '—'}
          </span>
        </div>
        <div className="mono mt-1 truncate text-sm" title={state.current.url ?? ''}>
          {state.current.url ?? '(starting…)'}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <Stat label="screens" value={t.screens} />
          <Stat label="steps" value={t.steps} />
          <Stat
            label="tokens"
            value={<span style={{ color: 'var(--text)' }}>{fmtTokens(t.tokens)}</span>}
          />
          <Stat label="elapsed" value={`${Math.round(t.elapsedMs / 1000)}s`} />
          <Stat label="tok/sec" value={Math.round(t.tokensPerSec)} />
        </div>
        {series.length > 1 && (
          <div className="mt-3" style={{ height: 90 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <YAxis hide />
                <Line
                  type="monotone"
                  dataKey="tokens"
                  stroke="var(--accent)"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-3">
          <h3 className="mb-2 font-medium">Moves</h3>
          {state.moves.length === 0 ? (
            <p className="muted text-sm">No moves yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {[...state.moves].reverse().map((m, i) => (
                <li key={`${m.ts}-${i}`} className="flex items-center gap-2">
                  <span className="muted mono text-xs">{m.action}</span>
                  <span className="truncate">{m.label ?? '—'}</span>
                  {m.isNew && (
                    <span className="text-xs" style={{ color: 'var(--pass)' }}>
                      +new
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-3">
          <h3 className="mb-2 font-medium">Screens ({state.screens.length})</h3>
          {state.screens.length === 0 ? (
            <p className="muted text-sm">No screens mapped yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {state.screens.map((s) => (
                <figure key={s.key} className="m-0">
                  <img
                    src={exploreShotUrl(s.key)}
                    alt={s.key}
                    loading="lazy"
                    className="card-raised aspect-video w-full object-cover"
                  />
                  <figcaption className="muted mono mt-0.5 truncate text-xs" title={s.key}>
                    {s.key}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
