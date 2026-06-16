/** Everything one watch frame needs — fully resolved, so the renderer is pure + snapshot-testable. */
export type WatchFrameInput = {
  version: string;
  project: string;
  run: { id: string; status: string; stage: string | null } | null;
  screens: Array<{ screenKey: string | null; state: string }>;
  /** Cumulative tokens this run, or null if unknown. */
  tokens: number | null;
  gatesOpen: number;
  questionsOpen: number;
  /** Age of the latest heartbeat in ms, or null if none yet. */
  heartbeatAgeMs: number | null;
  recent: Array<{ ts: string; type: string; wpId: string | null }>;
  /** Heartbeat staleness threshold (default 6 min) → the "is it wedged?" flag. */
  stalenessMs?: number;
};

const DEFAULT_STALENESS_MS = 6 * 60_000;
const RULE = '─'.repeat(52);

/** State order for the screen tally — active states first, terminal ones last. */
const STATE_ORDER = [
  'building',
  'evaluating',
  'fixing',
  'passed',
  'shipped',
  'blocked',
  'failed',
  'needs_human',
  'planned',
  'pending',
];

function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function humanAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

/**
 * Render one `loom watch` dashboard frame as plain text (no ANSI), so it's snapshot-testable by
 * feeding a fixed state in. It answers "what is the shift doing — and is it wedged?": the active
 * run + stage, a screen tally by state, token spend, the gates/questions waiting in the inbox, a
 * heartbeat-staleness flag, and the most recent events. The command layer wires this to the live
 * stores and repaints; the frame itself is pure.
 */
export function renderWatchFrame(input: WatchFrameInput): string {
  const lines: string[] = [];
  if (!input.run) {
    lines.push(
      `loom ${input.version} · ${input.project}`,
      RULE,
      'no active run — start one with `loom run`.',
    );
    return lines.join('\n');
  }

  const r = input.run;
  lines.push(
    `loom ${input.version} · ${input.project} · run ${r.id} [${r.stage ?? r.status}]`,
    RULE,
  );

  const counts = new Map<string, number>();
  for (const s of input.screens) counts.set(s.state, (counts.get(s.state) ?? 0) + 1);
  const tally = [...counts.entries()]
    .sort((a, b) => STATE_ORDER.indexOf(a[0]) - STATE_ORDER.indexOf(b[0]))
    .map(([state, n]) => `${n} ${state}`)
    .join(' · ');
  lines.push(`screens  ${input.screens.length}: ${tally || '—'}`);

  if (input.tokens !== null) lines.push(`tokens   ${compactTokens(input.tokens)}`);
  lines.push(`inbox    ${input.gatesOpen} gate(s) · ${input.questionsOpen} question(s) waiting`);

  const staleness = input.stalenessMs ?? DEFAULT_STALENESS_MS;
  if (input.heartbeatAgeMs === null) {
    lines.push('heartbeat —');
  } else if (input.heartbeatAgeMs > staleness) {
    lines.push(`heartbeat ${humanAge(input.heartbeatAgeMs)} ago — STALE, possibly wedged`);
  } else {
    lines.push(`heartbeat ${humanAge(input.heartbeatAgeMs)} ago`);
  }

  if (input.recent.length) {
    lines.push('', 'recent');
    for (const e of input.recent) {
      const time = e.ts.slice(11, 19); // HH:MM:SS from the ISO timestamp
      lines.push(`  ${time}  ${e.type}${e.wpId ? ` ${e.wpId}` : ''}`);
    }
  }
  return lines.join('\n');
}
