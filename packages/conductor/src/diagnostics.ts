export type ActivityClass = 'active' | 'long_running' | 'stalled' | 'stuck';

export type ActivityThresholds = {
  /** Elapsed past which a still-progressing attempt is "slow but alive". */
  longRunningMs?: number;
  /** Idle past which an attempt is "no recent activity — watch it". */
  stalledMs?: number;
  /** Idle past which an attempt is wedged and an abort candidate. */
  stuckMs?: number;
};

const DEFAULTS: Required<ActivityThresholds> = {
  longRunningMs: 3 * 60_000,
  stalledMs: 5 * 60_000,
  stuckMs: 10 * 60_000,
};

/**
 * Classify a worker's liveness for the heartbeat's "is it wedged?" signal:
 * `active` (progressing), `long_running` (slow but alive), `stalled` (no
 * activity for a while — watch it), `stuck` (idle past the abort threshold).
 * `idleMs` is time since the last tool call / event; `elapsedMs` the attempt
 * total. Idle dominates: a stuck/stalled attempt is judged by silence, not age.
 */
export function classifyActivity(input: {
  elapsedMs: number;
  idleMs: number;
  thresholds?: ActivityThresholds;
}): ActivityClass {
  const t = { ...DEFAULTS, ...input.thresholds };
  if (input.idleMs >= t.stuckMs) return 'stuck';
  if (input.idleMs >= t.stalledMs) return 'stalled';
  if (input.elapsedMs >= t.longRunningMs) return 'long_running';
  return 'active';
}
