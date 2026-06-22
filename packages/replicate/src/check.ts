import { captureDom, captureScreenshot, DEFAULT_VIEWPORT, type Viewport } from '@loom/browser';
import type { CodeAtlas } from '@loom/cartographer';
import {
  DEFAULT_STYLE_PROPS,
  diffDom,
  diffForms,
  diffStyles,
  evaluateVisual,
} from '@loom/evaluator';
import { extractForms } from '@loom/surveyor';
import { comparePaths, legacyNavTargets, replicaNavTargets } from './paths.js';
import { buildReport, type ParityReport } from './report.js';

export type CheckOptions = {
  /** The live legacy screen. */
  legacyUrl: string;
  /** The running replica screen (e.g. a served React build / vite preview at the screen's route). */
  replicaUrl: string;
  viewport?: Viewport;
  /** Max acceptable visual pixel-diff % (default 1). */
  threshold?: number;
  /** When given with `screenKey`, also checks path/route equivalence from the legacy nav graph. */
  atlas?: CodeAtlas;
  screenKey?: string;
  /** Saved Playwright auth state (cookies/localStorage) for the legacy side — the SSO bootstrap. */
  storageStatePath?: string;
};

/**
 * Deterministically compare a built replica screen against the live legacy screen across every gate —
 * visual pixel diff + DOM structure + computed style + forms + path/route equivalence. **No LLM.**
 * Returns the combined {@link ParityReport}; its findings are the exact differences the fix loop hands
 * the model.
 */
export async function checkParity(opts: CheckOptions): Promise<ParityReport> {
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const threshold = opts.threshold ?? 1;
  // The legacy side may be behind SSO — reuse a saved auth state. The replica is localhost, no auth.
  const legacyAuth = opts.storageStatePath ? { storageStatePath: opts.storageStatePath } : {};

  const [aShot, bShot] = await Promise.all([
    captureScreenshot({ url: opts.legacyUrl, viewport, ...legacyAuth }),
    captureScreenshot({ url: opts.replicaUrl, viewport }),
  ]);
  const visual = evaluateVisual(
    [{ state: opts.screenKey ?? 'screen', viewport: 'desktop', a: aShot, b: bShot }],
    { threshold },
  );

  const [domA, domB] = await Promise.all([
    captureDom({ url: opts.legacyUrl, viewport, styleProps: DEFAULT_STYLE_PROPS, ...legacyAuth }),
    captureDom({ url: opts.replicaUrl, viewport, styleProps: DEFAULT_STYLE_PROPS }),
  ]);
  const dom = diffDom(domA, domB);
  const style = diffStyles(domA, domB);
  const forms = diffForms(extractForms(domA), extractForms(domB));
  const paths =
    opts.atlas && opts.screenKey
      ? comparePaths(legacyNavTargets(opts.atlas, opts.screenKey), replicaNavTargets(domB))
      : [];

  return buildReport({
    visualPct: visual.verdict.worst.diffPercent,
    threshold,
    dom: dom.findings,
    style: style.findings,
    forms,
    paths,
  });
}
