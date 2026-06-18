import type { LiveWorker } from '../api';
import { elapsedLabel, fmtTokens, stateTone, type Tone } from '../lib/board';

const toneVar = (t: Tone): string => (t === 'muted' ? 'var(--text-muted)' : `var(--${t})`);

/** The live fleet: a card per active worker (screen · phase · attempt · elapsed · tokens). */
export function LiveFleet({
  workers,
  onSelect,
}: {
  workers: LiveWorker[];
  onSelect?: (wpId: string) => void;
}) {
  if (workers.length === 0) {
    return <p className="muted text-sm">No workers running right now.</p>;
  }
  const now = Date.now();
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {workers.map((w) => {
        const tone = stateTone(w.state);
        return (
          <div
            key={w.wpId}
            className={`card-raised p-3${onSelect ? ' cursor-pointer' : ''}`}
            style={{ borderLeft: `3px solid ${toneVar(tone)}` }}
            data-wp={w.wpId}
            {...(onSelect ? { role: 'button', tabIndex: 0, onClick: () => onSelect(w.wpId) } : {})}
          >
            <div className="flex items-center justify-between">
              <span className="mono truncate text-sm" title={w.screenKey ?? w.wpId}>
                {w.screenKey ?? w.wpId}
              </span>
              <span className="text-xs" style={{ color: toneVar(tone) }}>
                {w.state}
              </span>
            </div>
            <div className="muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              <span>attempt {w.attempt}</span>
              <span>{elapsedLabel(w.startedAt, now)}</span>
              <span>
                <b className="font-normal" style={{ color: 'var(--text)' }}>
                  {fmtTokens(w.tokens)}
                </b>{' '}
                tok
              </span>
            </div>
            {w.lastEvent && <div className="muted mono mt-1 truncate text-xs">↳ {w.lastEvent}</div>}
          </div>
        );
      })}
    </div>
  );
}
