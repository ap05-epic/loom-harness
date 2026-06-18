import { columnsFromScreens, type Screen, type Tone } from '../lib/board';

/** Map a brand tone to its CSS variable (muted → the muted text token). */
function toneVar(t: Tone): string {
  return t === 'muted' ? 'var(--text-muted)' : `var(--${t})`;
}

function ScreenCard({ s, tone }: { s: Screen; tone: Tone }) {
  const label = s.screenKey ?? s.wpId;
  return (
    <div
      className="card-raised px-2 py-1.5"
      style={{ borderLeft: `3px solid ${toneVar(tone)}` }}
      data-wp={s.wpId}
    >
      <div className="mono truncate text-sm" title={label}>
        {label}
      </div>
      <div className="muted flex gap-2 text-xs">
        <span>att {s.attempts}</span>
        {s.diffPercent != null && <span>{s.diffPercent.toFixed(1)}%</span>}
      </div>
    </div>
  );
}

/** The kanban board: a column per pipeline state, screens as cards that move across as they progress. */
export function KanbanBoard({ screens }: { screens: Screen[] }) {
  const columns = columnsFromScreens(screens);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((c) => (
        <div key={c.state} className="card flex min-w-[150px] flex-1 flex-col">
          <div
            className="flex items-center justify-between border-b px-3 py-2"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-sm font-medium" style={{ color: toneVar(c.tone) }}>
              {c.label}
            </span>
            <span className="muted text-xs">{c.screens.length}</span>
          </div>
          <div className="flex flex-col gap-2 p-2">
            {c.screens.map((s) => (
              <ScreenCard key={s.wpId} s={s} tone={c.tone} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
