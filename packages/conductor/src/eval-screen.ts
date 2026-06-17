import {
  diffA11y,
  diffDom,
  diffForms,
  diffStyles,
  evaluateVisual,
  findCopiedAssets,
  type A11yFinding,
  type A11yViolation,
  type AssetDigest,
  type CopiedAsset,
  type DomFinding,
  type FunctionalFinding,
  type StyleFinding,
} from '@loom/evaluator';
import type { DomSnapshot, Viewport } from '@loom/browser';
import { extractForms } from '@loom/surveyor';
import { scanAssets } from './assets.js';
import { serveDir, type StaticServer } from './serve.js';

type Capture = (input: { url: string; viewport: Viewport }) => Promise<Buffer>;
type DomCapture = (input: { url: string; viewport: Viewport }) => Promise<DomSnapshot>;
type A11yCapture = (input: { url: string; viewport: Viewport }) => Promise<A11yViolation[]>;

/** The verdict of evaluating one rebuilt screen against its legacy baseline (no DB side effects). */
export type ScreenEval = {
  diffPercent: number;
  findings: DomFinding[];
  styleFindings: StyleFinding[];
  /** Form fields/rules the rebuild dropped or changed (the functional gate). */
  functionalFindings: FunctionalFinding[];
  /** Accessibility regressions A→B (empty when the a11y seam isn't supplied). */
  a11yFindings: A11yFinding[];
  /** Rebuild assets copied verbatim from legacy (empty when no legacy digests are supplied). */
  copiedAssets: CopiedAsset[];
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
  /** Optional accessibility seam (axe). When supplied, A-vs-B a11y is a gate. */
  a11yCapture?: A11yCapture;
  /** Legacy source asset digests. When supplied, copied-asset detection is a gate (anti-cheat). */
  legacyAssets?: AssetDigest[];
};

/**
 * Evaluate one rebuilt screen against its legacy baseline across the deterministic parity gates and
 * report the combined verdict. Always on: visual pixel diff, structural DOM, computed-style, and the
 * functional/validation gate (legacy form fields + rules must survive). Two more become gates when
 * their seam is supplied: accessibility (`a11yCapture`, axe) and anti-cheat (`legacyAssets`,
 * copied-asset detection). Shared by the per-attempt BUILD→EVAL loop and the cross-screen
 * integration eval, so there is exactly one definition of "does this screen pass parity".
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
    // Functional gate: every legacy form field + validation rule must survive the rebuild.
    const functional = diffForms(extractForms(domA), extractForms(domB));
    // Accessibility gate (optional): the rebuild must not be less accessible than the legacy screen.
    let a11yFindings: A11yFinding[] = [];
    if (args.a11yCapture) {
      const a11yB = await args.a11yCapture({ url: server.url, viewport: args.viewport });
      const a11yA = await args.a11yCapture({ url: args.legacyUrl, viewport: args.viewport });
      a11yFindings = diffA11y(a11yA, a11yB);
    }
    // Anti-cheat gate (optional): no rebuild file may be byte-identical to a legacy source asset.
    const copiedAssets = args.legacyAssets
      ? findCopiedAssets(args.legacyAssets, scanAssets(args.bRepoDir))
      : [];
    return {
      diffPercent: visual.verdict.worst.diffPercent,
      findings: structural.findings,
      styleFindings: style.findings,
      functionalFindings: functional,
      a11yFindings,
      copiedAssets,
      passed:
        visual.verdict.passed &&
        structural.matched &&
        style.matched &&
        functional.length === 0 &&
        a11yFindings.length === 0 &&
        copiedAssets.length === 0,
      scorecard: {
        visual: visual.verdict,
        structural,
        style,
        functional,
        a11y: a11yFindings,
        copiedAssets,
      },
    };
  } finally {
    await server.stop();
  }
}
