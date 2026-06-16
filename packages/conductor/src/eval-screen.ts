import {
  diffDom,
  diffStyles,
  evaluateVisual,
  type DomFinding,
  type StyleFinding,
} from '@loom/evaluator';
import type { DomSnapshot, Viewport } from '@loom/browser';
import { serveDir, type StaticServer } from './serve.js';

type Capture = (input: { url: string; viewport: Viewport }) => Promise<Buffer>;
type DomCapture = (input: { url: string; viewport: Viewport }) => Promise<DomSnapshot>;

/** The verdict of evaluating one rebuilt screen against its legacy baseline (no DB side effects). */
export type ScreenEval = {
  diffPercent: number;
  findings: DomFinding[];
  styleFindings: StyleFinding[];
  passed: boolean;
  scorecard: unknown;
};

export type EvaluateScreenArgs = {
  /** Label for the visual scorecard (the screen key). */
  stateKey: string;
  /** Directory holding the rebuilt screen (served statically). */
  bRepoDir: string;
  /** The legacy "A" baseline screenshot. */
  baseline: Buffer;
  /** Live legacy URL for the structural/style DOM compare. */
  legacyUrl: string;
  capture: Capture;
  domCapture: DomCapture;
  viewport: Viewport;
  threshold: number;
  /** Static-server seam (default `serveDir`); injected in tests. */
  serve?: (dir: string) => Promise<StaticServer>;
};

/**
 * Evaluate one rebuilt screen against its legacy baseline across all three deterministic gates
 * (visual pixel diff, structural DOM, computed-style) and report the combined verdict. Shared by
 * the per-attempt BUILD→EVAL loop and the cross-screen integration eval, so there is exactly one
 * definition of "does this screen pass parity".
 */
export async function evaluateScreen(args: EvaluateScreenArgs): Promise<ScreenEval> {
  const serve = args.serve ?? serveDir;
  const server = await serve(args.bRepoDir);
  try {
    const rebuilt = await args.capture({ url: server.url, viewport: args.viewport });
    const visual = evaluateVisual(
      [{ state: args.stateKey, viewport: 'desktop', a: args.baseline, b: rebuilt }],
      { threshold: args.threshold },
    );
    const domB = await args.domCapture({ url: server.url, viewport: args.viewport });
    const domA = await args.domCapture({ url: args.legacyUrl, viewport: args.viewport });
    const structural = diffDom(domA, domB);
    const style = diffStyles(domA, domB);
    return {
      diffPercent: visual.verdict.worst.diffPercent,
      findings: structural.findings,
      styleFindings: style.findings,
      passed: visual.verdict.passed && structural.matched && style.matched,
      scorecard: { visual: visual.verdict, structural, style },
    };
  } finally {
    await server.stop();
  }
}
