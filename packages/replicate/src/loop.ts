import { diffsForLlm, type ParityReport } from './report.js';

export type BuildArgs = {
  iteration: number;
  /** The concrete differences to fix — undefined on the first iteration (build from scratch). */
  diffs?: string;
};

export type LoopStep =
  | { phase: 'build'; iteration: number; diffs?: string }
  | { phase: 'checked'; iteration: number; report: ParityReport };

export type ReplicateOptions = {
  /** Write (or fix) the React for the screen. First call: `diffs` undefined → build; retries: the diffs. */
  build: (args: BuildArgs) => Promise<void>;
  /** Deterministically check the built replica against the legacy screen (no LLM). */
  check: () => Promise<ParityReport>;
  /** Hard cap on build→check rounds (default 6). */
  maxIterations?: number;
  /** Streamed progress, for the terminal. */
  onStep?: (step: LoopStep) => void;
  /** Called when iteration `i` is the new best — snapshot the written files so we can roll back to it. */
  onSnapshotBest?: (iteration: number) => void;
  /** Called before a fix (and at the end) to roll the files back to the best version so far. */
  onRestoreBest?: () => void;
};

export type ReplicateResult = { matched: boolean; iterations: number; report: ParityReport };

/** Count the blocking-ish findings (lower = closer to 1:1). */
function findingCount(r: ParityReport): number {
  return r.dom.length + r.style.length + r.forms.length + r.paths.length + (r.live ?? []).length;
}

/**
 * Is report `a` strictly better than `b`? Order: a 1:1 match wins; then no build error wins (a build
 * failure rendered nothing); then a lower visual pixel‑diff; then fewer structural/style/form/route/
 * live findings. This is what makes the loop keep the BEST result instead of whatever the last
 * (possibly worse) iteration produced.
 */
export function isBetter(a: ParityReport, b: ParityReport): boolean {
  if (a.matched !== b.matched) return a.matched;
  const aBuildErr = (a.build ?? []).length > 0;
  const bBuildErr = (b.build ?? []).length > 0;
  if (aBuildErr !== bBuildErr) return !aBuildErr;
  if (a.visualPct !== b.visualPct) return a.visualPct < b.visualPct;
  return findingCount(a) < findingCount(b);
}

/**
 * The build → check → fix loop. Build (or fix) the React, deterministically check it against the
 * legacy screen, and if it isn't 1:1, hand the model **only the concrete differences** and try again
 * — until the machine reports a match or the iteration cap is hit. The model never judges parity; it
 * only closes the gaps the checker found.
 *
 * **Never regresses:** it tracks the BEST iteration, always fixes *from* the best (rolling the files
 * back first), and returns the best — so a fix that makes things worse is discarded, not kept.
 */
export async function replicateScreen(opts: ReplicateOptions): Promise<ReplicateResult> {
  const max = opts.maxIterations ?? 6;
  let best: ParityReport | undefined;
  for (let i = 1; i <= max; i++) {
    // Fix FROM the best version so far (not a regression): roll the files back, hand it the best's diffs.
    if (best) opts.onRestoreBest?.();
    const diffs = best ? diffsForLlm(best) : undefined;
    opts.onStep?.({ phase: 'build', iteration: i, diffs });
    await opts.build({ iteration: i, diffs });
    const report = await opts.check();
    opts.onStep?.({ phase: 'checked', iteration: i, report });
    if (!best || isBetter(report, best)) {
      best = report;
      opts.onSnapshotBest?.(i); // the files on disk now ARE the best — snapshot them
    }
    if (best.matched) return { matched: true, iterations: i, report: best };
  }
  // The last iteration may have regressed — leave the BEST version on disk.
  opts.onRestoreBest?.();
  return { matched: false, iterations: max, report: best! };
}
