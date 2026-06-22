import {
  captureDom,
  captureScreenshot,
  DEFAULT_VIEWPORT,
  type DomSnapshot,
  type Viewport,
} from '@loom/browser';
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
import { buildReport, type ParityGate, type ParityReport } from './report.js';

/**
 * Lift a single SPA mount container (`<div id="root">` / `<div id="app">`) so the replica's real
 * content aligns with the legacy `<body>`. The mount wrapper is a framework artifact the legacy page
 * doesn't have — without this it shows up as a phantom `center → div` and shifts the whole tree one
 * level, poisoning the structural + style diffs.
 */
function unwrapMount(body: DomSnapshot): DomSnapshot {
  if (body.children.length === 1) {
    const only = body.children[0]!;
    if (only.tag === 'div' && (only.attrs.id === 'root' || only.attrs.id === 'app')) {
      return { ...body, children: only.children };
    }
  }
  return body;
}

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
  /** Which gates must be clean for a match (default `strict`; `visual` = looks + works the same). */
  gate?: ParityGate;
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

  const [rawA, rawB] = await Promise.all([
    captureDom({ url: opts.legacyUrl, viewport, styleProps: DEFAULT_STYLE_PROPS, ...legacyAuth }),
    captureDom({ url: opts.replicaUrl, viewport, styleProps: DEFAULT_STYLE_PROPS }),
  ]);
  // Unwrap the SPA mount container on both sides so the replica's content aligns with the legacy body.
  const domA = unwrapMount(rawA);
  const domB = unwrapMount(rawB);
  const dom = diffDom(domA, domB);
  const style = diffStyles(domA, domB);
  const forms = diffForms(extractForms(domA), extractForms(domB));
  const paths =
    opts.atlas && opts.screenKey
      ? comparePaths(legacyNavTargets(opts.atlas, opts.screenKey), replicaNavTargets(domB))
      : [];

  return buildReport(
    {
      visualPct: visual.verdict.worst.diffPercent,
      threshold,
      dom: dom.findings,
      style: style.findings,
      forms,
      paths,
    },
    opts.gate,
  );
}
