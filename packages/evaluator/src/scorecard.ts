export type StateDiff = {
  /** Screen/state key (e.g. "login", "list:filtered"). */
  state: string;
  /** Viewport key (e.g. "desktop", "mobile"). */
  viewport: string;
  /** Visual difference for this state×viewport, as a percentage of pixels. */
  diffPercent: number;
};

export type VisualScoreOptions = {
  /** Default max acceptable diff % per state×viewport. */
  threshold: number;
  /** Optional per-state overrides (a human-approved deviation). */
  perStateThreshold?: Record<string, number>;
};

export type VisualVerdict = {
  passed: boolean;
  threshold: number;
  /** The worst state×viewport (highest diff). */
  worst: StateDiff;
  /** Every state×viewport that exceeded its threshold. */
  failures: StateDiff[];
  /** All inputs, for the report. */
  states: StateDiff[];
};

const ZERO_WORST: StateDiff = { state: '(none)', viewport: '(none)', diffPercent: 0 };

/**
 * The visual-parity layer of the judge: a rebuild passes only if every captured
 * state×viewport is within its threshold. Deterministic and pure, so it is
 * mutation-tested in both directions (passes faithful rebuilds, fails sabotaged
 * ones) before anything consumes its verdicts.
 */
export function scoreVisual(diffs: StateDiff[], options: VisualScoreOptions): VisualVerdict {
  const thresholdFor = (state: string): number =>
    options.perStateThreshold?.[state] ?? options.threshold;

  const failures = diffs.filter((d) => d.diffPercent > thresholdFor(d.state));
  const worst = diffs.reduce<StateDiff>(
    (max, d) => (d.diffPercent > max.diffPercent ? d : max),
    ZERO_WORST,
  );

  return {
    passed: failures.length === 0,
    threshold: options.threshold,
    worst,
    failures,
    states: diffs,
  };
}
