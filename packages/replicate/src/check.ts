import {
  captureDom,
  captureScreenshot,
  CrawlSession,
  DEFAULT_VIEWPORT,
  type DomSnapshot,
  type NetworkRequest,
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

/**
 * The anti-hardcoding gate (pure): did the replica fetch its data from the real backend (any request
 * under the proxied context prefix), or did it render hardcoded values (no backend fetch)? A snapshot
 * fails. No LLM.
 */
export function liveDataGate(
  requests: NetworkRequest[],
  contextPrefix: string,
): { fetchedLive: boolean; hits: string[] } {
  const hits = requests.filter((r) => r.url.includes(contextPrefix)).map((r) => r.url);
  return { fetchedLive: hits.length > 0, hits };
}

/** Load the served replica, record its network calls, and run {@link liveDataGate} against them. */
async function replicaFetchedLive(
  replicaUrl: string,
  contextPrefix: string,
  viewport: Viewport,
): Promise<{ fetchedLive: boolean; hits: string[] }> {
  const session = new CrawlSession({ viewport });
  await session.open();
  try {
    session.startNetworkLog();
    await session.navigate(replicaUrl);
    await session.awaitStable(8000);
    return liveDataGate(session.drainNetworkLog(), contextPrefix);
  } finally {
    await session.close();
  }
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
  /**
   * Pre-captured legacy snapshot (screenshot + DOM). When given, the legacy side is NOT re-captured —
   * essential for apps (BAA) where the screen only exists inside a live login session, so we capture
   * it once up front and reuse it every iteration.
   */
  cachedLegacy?: { shot: Buffer; dom: DomSnapshot };
  /**
   * Anti-hardcoding gate: when set, verify the replica fetched its data from the real backend (a
   * request under `contextPrefix`, e.g. `/BAA`) rather than rendering hardcoded values. Fails the
   * match if it didn't.
   */
  liveData?: { contextPrefix: string };
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

  // Legacy side: reuse a pre-captured snapshot when given (BAA won't serve a cold GET); else capture
  // it now (optionally with a saved storage state). Replica side: always captured fresh.
  const aShot = opts.cachedLegacy
    ? opts.cachedLegacy.shot
    : await captureScreenshot({ url: opts.legacyUrl, viewport, ...legacyAuth });
  const rawA = opts.cachedLegacy
    ? opts.cachedLegacy.dom
    : await captureDom({
        url: opts.legacyUrl,
        viewport,
        styleProps: DEFAULT_STYLE_PROPS,
        ...legacyAuth,
      });
  const bShot = await captureScreenshot({ url: opts.replicaUrl, viewport });
  const rawB = await captureDom({
    url: opts.replicaUrl,
    viewport,
    styleProps: DEFAULT_STYLE_PROPS,
  });

  const visual = evaluateVisual(
    [{ state: opts.screenKey ?? 'screen', viewport: 'desktop', a: aShot, b: bShot }],
    { threshold },
  );
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

  // Anti-hardcoding gate: confirm the replica actually fetched live data from the real backend.
  let live: string[] = [];
  if (opts.liveData) {
    const r = await replicaFetchedLive(opts.replicaUrl, opts.liveData.contextPrefix, viewport);
    if (!r.fetchedLive)
      live = [
        `the replica made no request to the backend (expected a fetch under ${opts.liveData.contextPrefix})`,
      ];
  }

  return buildReport(
    {
      visualPct: visual.verdict.worst.diffPercent,
      threshold,
      dom: dom.findings,
      style: style.findings,
      forms,
      paths,
      live,
    },
    opts.gate,
  );
}
