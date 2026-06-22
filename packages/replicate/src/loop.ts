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
};

export type ReplicateResult = { matched: boolean; iterations: number; report: ParityReport };

/**
 * The build → check → fix loop. Build (or fix) the React, deterministically check it against the
 * legacy screen, and if it isn't 1:1, hand the model **only the concrete differences** and try again
 * — until the machine reports a match or the iteration cap is hit. The model never judges parity; it
 * only closes the gaps the checker found.
 */
export async function replicateScreen(opts: ReplicateOptions): Promise<ReplicateResult> {
  const max = opts.maxIterations ?? 6;
  let report: ParityReport | undefined;
  for (let i = 1; i <= max; i++) {
    const diffs = report ? diffsForLlm(report) : undefined;
    opts.onStep?.({ phase: 'build', iteration: i, diffs });
    await opts.build({ iteration: i, diffs });
    report = await opts.check();
    opts.onStep?.({ phase: 'checked', iteration: i, report });
    if (report.matched) return { matched: true, iterations: i, report };
  }
  return { matched: false, iterations: max, report: report! };
}
