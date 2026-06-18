/** One screen (work package) as the dashboard sees it — mirrors @loom/mission-control DashboardState. */
export type Screen = {
  wpId: string;
  screenKey: string | null;
  state: string;
  diffPercent: number | null;
  attempts: number;
};

/** The pipeline states, in flow order — the kanban columns (shown even when empty so cards visibly move). */
export const WP_STATES = [
  'pending',
  'planned',
  'building',
  'evaluating',
  'fixing',
  'passed',
  'shipped',
  'blocked',
  'needs_human',
  'failed',
] as const;

/** A brand tone (a `--<tone>` CSS variable) for a state's accent. */
export type Tone = 'pass' | 'fail' | 'info' | 'gate' | 'accent' | 'muted';

const TONES: Record<string, Tone> = {
  passed: 'pass',
  shipped: 'pass',
  failed: 'fail',
  blocked: 'gate',
  needs_human: 'gate',
  building: 'info',
  evaluating: 'info',
  fixing: 'info',
  planned: 'accent',
};

/** Map a work-package state to a brand tone (unknown → muted). */
export function stateTone(state: string): Tone {
  return TONES[state] ?? 'muted';
}

/** A human label for a state (snake_case → "Title Case"). */
export function stateLabel(state: string): string {
  return state.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export type Column = { state: string; label: string; tone: Tone; screens: Screen[] };

/**
 * Group screens into kanban columns: one per known state in flow order (empty columns kept so
 * cards visibly move across), then any unknown states that appear — so no screen is ever dropped.
 */
export function columnsFromScreens(screens: Screen[]): Column[] {
  const byState = new Map<string, Screen[]>();
  for (const s of screens) {
    const list = byState.get(s.state) ?? [];
    list.push(s);
    byState.set(s.state, list);
  }
  const order: string[] = [...WP_STATES];
  for (const state of byState.keys()) if (!order.includes(state)) order.push(state);
  return order.map((state) => ({
    state,
    label: stateLabel(state),
    tone: stateTone(state),
    screens: byState.get(state) ?? [],
  }));
}

/** Abbreviate a token count: 950 → "950", 1500 → "1.5k", 2_300_000 → "2.3M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trim1(n / 1000)}k`;
  return `${trim1(n / 1_000_000)}M`;
}

function trim1(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/** A short elapsed-since label for a worker, e.g. "5s", "1m 5s", "1h 30m" (pure; `now` injected). */
export function elapsedLabel(startedAt: string | null, now: number): string {
  if (!startedAt) return '—';
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return '—';
  const s = Math.max(0, Math.floor((now - started) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
