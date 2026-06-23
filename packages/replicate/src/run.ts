import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmGateway, ToolDef } from '@loom/agents';
import {
  captureDom,
  captureScreenshot,
  DEFAULT_VIEWPORT,
  type DomSnapshot,
  type NetworkRequest,
  type Viewport,
} from '@loom/browser';
import type { CodeAtlas } from '@loom/cartographer';
import { buildScreen } from '@loom/conductor';
import { DEFAULT_STYLE_PROPS } from '@loom/evaluator';
import { screenKey } from '@loom/surveyor';
import { contextFromUrl, injectStylesheets, reuseLegacyAssets } from './assets.js';
import { createCrawlQueryTool, createReadFileTool } from './builder-tools.js';
import { openCrawlDb } from './crawl-db.js';
import { checkParity } from './check.js';
import { loginAndCapture, type FaGateway, type LoginConfig } from './login.js';
import { replicateScreen, type BuildArgs, type ReplicateResult } from './loop.js';
import { extractNavigation } from './nav.js';
import { legacyNavTargets, normalizePath, replicaNavTargets } from './paths.js';
import {
  buildReactWorkOrder,
  REACT_SYSTEM_PROMPT,
  type JspSource,
  type ReactRecipeInput,
} from './recipe.js';
import { runAppBuild, serveStatic, type StaticProxy } from './react-target.js';
import { serializeRendered } from './rendered.js';
import {
  buildReport,
  diffsForLlm,
  printReport,
  type ParityGate,
  type ParityReport,
} from './report.js';

export type RunOptions = {
  atlas: CodeAtlas;
  screenKey: string;
  /** The live legacy screen to match. */
  legacyUrl: string;
  /** The React app directory the model writes into and we build/serve. */
  appDir: string;
  gateway: LlmGateway;
  model: string;
  /** Build command run in `appDir` (default `npx vite build`). */
  buildCmd?: string;
  /** Subdir of `appDir` to serve after building (default `dist`). */
  serveSubdir?: string;
  /** Route the screen renders at in the served app (default `/`). */
  route?: string;
  /** Where the model writes the screen component, relative to `appDir` (default `src/App.tsx`). */
  componentPath?: string;
  /** Supplies legacy JSP source (e.g. read from the webapp dir). */
  jspSource?: JspSource;
  /** The legacy webapp root — used to mirror its static assets when `reuseAssets` is set. */
  webappDir?: string;
  /** Copy the legacy CSS/images/fonts into the React app + link them, so the model reuses the real
   * styling instead of recreating it. The model then reproduces markup + class names only. */
  reuseAssets?: boolean;
  threshold?: number;
  maxIterations?: number;
  viewport?: Viewport;
  /** Saved Playwright auth state for the legacy side (SSO). */
  storageStatePath?: string;
  /**
   * Live-login capture: log in and capture the legacy screen in ONE session (for apps like BAA that
   * reject a restored cookie). `targetUrl` is the post-login screen to navigate to; omit to capture
   * the landing page. When set, the legacy is captured once up front and reused every iteration.
   */
  login?: LoginConfig & { targetUrl?: string };
  /** The FA gateway — reach the real application + capture the FA-selected (data-filled) state. */
  fa?: FaGateway;
  /** Max wait for the mainframe to finish loading a page before capture (ms, default 15000). */
  loadMs?: number;
  /** Save a per-screen prep artifact (data endpoints + runtime links + states) into this folder. */
  screensDir?: string;
  /** Runtime crawl DB (`rep crawl`) — feeds the builder the real user paths + data provenance + read tools. */
  crawlDbPath?: string;
  /** Where the crawl wrote response bodies (for the read_file tool). Default `.loom/crawl-bodies`. */
  crawlBodiesDir?: string;
  /** Parity gate: `strict` (every gate) or `visual` (looks + works the same). Default strict. */
  gate?: ParityGate;
  /**
   * Save a screenshot of the final replica (and the original) into this folder when the run ends —
   * for viewing without a browser. Named by screen key, so re-running a screen overwrites rather than
   * piling up copies. Undefined = don't capture.
   */
  shotsDir?: string;
  /** Verbose terminal streaming. */
  onLog?: (msg: string) => void;
};

/**
 * Reconcile the live DOM's links against the static map (flag AJAX/dynamic links struts-config doesn't
 * know) and save a per-screen prep artifact — the data endpoints, runtime links, and which states
 * exist — so the converter (and the user) know each screen's data source + navigation up front.
 */
function recordScreenPrep(p: {
  atlas: CodeAtlas;
  screenKey: string;
  dom: DomSnapshot;
  endpoints: NetworkRequest[];
  finalUrl: string;
  hasNoFa: boolean;
  hasFa: boolean;
  screensDir?: string;
  log: (m: string) => void;
}): void {
  const staticSet = new Set(
    legacyNavTargets(p.atlas, p.screenKey)
      .map(normalizePath)
      .filter((x): x is string => Boolean(x)),
  );
  const runtimeLinks = extractNavigation(p.dom);
  const ajaxOnly = [
    ...new Set(
      replicaNavTargets(p.dom)
        .map(normalizePath)
        .filter((x): x is string => Boolean(x)),
    ),
  ].filter((t) => !staticSet.has(t));
  if (ajaxOnly.length > 0)
    p.log(
      `  ⓘ ${ajaxOnly.length} runtime link(s) not in the static map (AJAX/dynamic): ${ajaxOnly.slice(0, 8).join(', ')}`,
    );
  if (p.endpoints.length > 0)
    p.log(
      `  🔌 ${p.endpoints.length} data endpoint(s): ${p.endpoints
        .slice(0, 6)
        .map((e) => `${e.method} ${e.url}`)
        .join(' · ')}`,
    );
  if (!p.screensDir) return;
  try {
    mkdirSync(p.screensDir, { recursive: true });
    const out = join(p.screensDir, `${p.screenKey}.json`);
    writeFileSync(
      out,
      JSON.stringify(
        {
          screen: p.screenKey,
          finalUrl: p.finalUrl,
          states: { noFa: p.hasNoFa, faSelected: p.hasFa },
          endpoints: p.endpoints,
          runtimeLinks,
          ajaxOnlyLinks: ajaxOnly,
        },
        null,
        2,
      ),
    );
    p.log(`  📝 prep artifact → ${out}`);
  } catch (e) {
    p.log(`  ⚠ couldn't save the prep artifact: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * The full per‑screen loop: the model writes/fixes the React, we build + serve it, the deterministic
 * checker compares it to the live legacy screen, and if it isn't 1:1 the model is handed **only** the
 * concrete differences and we go again — until the machine reports a match or the cap. The model never
 * judges parity.
 */
export async function runReplicate(opts: RunOptions): Promise<ReplicateResult> {
  const screen = opts.atlas.screens().find((s) => s.key === opts.screenKey);
  if (!screen) throw new Error(`screen "${opts.screenKey}" is not in the atlas`);
  const log = opts.onLog ?? (() => {});
  const buildCmd = opts.buildCmd ?? 'npx vite build';
  const serveSubdir = opts.serveSubdir ?? 'dist';
  const route = opts.route ?? '/';
  const threshold = opts.threshold ?? 1;
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  let lastBuildError: string | undefined;

  // Reuse the legacy's real CSS/assets instead of recreating them: mirror them into the app's public/
  // dir + link them, so the model only has to reproduce markup + class names (the real CSS styles it).
  let reusedCss = false;
  if (opts.reuseAssets && opts.webappDir) {
    try {
      const context = contextFromUrl(opts.login?.loginUrl ?? opts.legacyUrl);
      const cssUrls = reuseLegacyAssets({
        webappDir: opts.webappDir,
        appDir: opts.appDir,
        context,
        log,
      });
      injectStylesheets(join(opts.appDir, 'index.html'), cssUrls);
      reusedCss = cssUrls.length > 0;
    } catch (e) {
      log(`  ⚠ couldn't reuse legacy assets: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Pre-read the live legacy screen once: its rendered tags + the exact computed styles the checker
  // measures. This is the most precise target we can hand the model — better than the JSP template
  // alone. Best-effort: if the legacy isn't reachable, fall back to JSP source only.
  let renderedTarget: string | undefined;
  let cachedLegacy: { shot: Buffer; dom: DomSnapshot } | undefined;
  let legacyVisionShot: Buffer | undefined;
  let legacyEndpoints: NetworkRequest[] = [];
  let proxy: StaticProxy | undefined;
  let crawlData: ReactRecipeInput['crawl'];
  let builderTools: ToolDef[] | undefined;
  if (opts.login) {
    // Log in and capture the legacy screen in ONE live session; reuse it every iteration. When an FA
    // gateway is set, the primary capture is the FA-selected (data-filled) state.
    log('  🔑 logging in + capturing the legacy screen (one live session)…');
    const cap = await loginAndCapture({
      ...opts.login,
      viewport,
      onLog: log,
      fa: opts.fa,
      loadMs: opts.loadMs,
    });
    cachedLegacy = { shot: cap.screenshot, dom: cap.dom };
    legacyVisionShot = cap.visionShot;
    legacyEndpoints = cap.endpoints;
    renderedTarget = serializeRendered(cap.dom);
    log(
      `    captured the legacy screen (${renderedTarget.length} chars; ended at ${cap.finalUrl})`,
    );
    // Proxy the legacy context path to the real backend (with this session's cookie) so the served
    // replica fetches LIVE data from the same endpoints the JSP uses — not a hardcoded snapshot.
    const ctx = contextFromUrl(opts.login.loginUrl);
    if (ctx) {
      proxy = {
        prefix: `/${ctx}`,
        target: new URL(opts.login.loginUrl).origin,
        headers: cap.cookieHeader ? { cookie: cap.cookieHeader } : undefined,
      };
      log(`  🔌 live-data proxy: ${proxy.prefix}/* → ${proxy.target}`);
    }

    // Runtime crawl: match this screen to its crawled state (by live screenKey), feed the builder the
    // real user paths + data provenance, and hand it read_file + query_crawl so it can dig in itself.
    if (opts.crawlDbPath) {
      const bodiesDir = opts.crawlBodiesDir ?? '.loom/crawl-bodies';
      try {
        const store = openCrawlDb(opts.crawlDbPath, { bodiesDir, secrets: [] });
        try {
          const liveKey = screenKey({ url: cap.finalUrl, dom: cap.dom });
          const st =
            store.graph().states.find((s) => s.key === liveKey) ??
            store.graph().states.find((s) => s.url === cap.finalUrl);
          if (st) {
            crawlData = {
              interactions: store
                .interactionsFor(st.id)
                .filter((e) => e.action_target)
                .map((e) => ({
                  label: e.label ?? '',
                  target: e.action_target!,
                  kind: e.kind ?? 'navigation',
                })),
              provenance: store
                .provenanceFor(st.id)
                .filter((p) => p.endpoint_url)
                .map((p) => ({
                  value: p.value,
                  endpointUrl: p.endpoint_url!,
                  label: p.label ?? undefined,
                })),
            };
            log(
              `  🗺 crawl: ${crawlData.interactions?.length ?? 0} user-path link(s), ${crawlData.provenance?.length ?? 0} provenance value(s)`,
            );
          } else {
            log(
              `  ⓘ no crawled state matched this screen (key ${liveKey}) — run \`rep crawl\` first`,
            );
          }
        } finally {
          store.close();
        }
      } catch (e) {
        log(`  ⚠ couldn't read the crawl DB: ${e instanceof Error ? e.message : String(e)}`);
      }
      const roots = [opts.webappDir, bodiesDir].filter((x): x is string => Boolean(x));
      builderTools = [createReadFileTool(roots), createCrawlQueryTool(opts.crawlDbPath, bodiesDir)];
    }

    recordScreenPrep({
      atlas: opts.atlas,
      screenKey: opts.screenKey,
      dom: cap.dom,
      endpoints: cap.endpoints,
      finalUrl: cap.finalUrl,
      hasNoFa: Boolean(cap.preFa),
      hasFa: Boolean(opts.fa),
      screensDir: opts.screensDir,
      log,
    });
  } else {
    // Pre-read the live legacy screen once: its rendered tags + the exact computed styles the checker
    // measures — better than the JSP template alone. Best-effort: fall back to JSP source only.
    try {
      log('  📸 reading the live legacy screen (rendered DOM + computed styles)…');
      const legacyDom = await captureDom({
        url: opts.legacyUrl,
        viewport,
        styleProps: DEFAULT_STYLE_PROPS,
        ...(opts.storageStatePath ? { storageStatePath: opts.storageStatePath } : {}),
      });
      renderedTarget = serializeRendered(legacyDom);
      log(`    got the rendered target (${renderedTarget.length} chars)`);
    } catch (e) {
      log(
        `  ⚠ couldn't pre-read the legacy DOM (${e instanceof Error ? e.message : String(e)}); using JSP source only`,
      );
    }
  }

  // The legacy screenshot (the visual TARGET) — fed to the model so it can SEE the WHOLE screen
  // (full-page, below the fold), not just read its structure. Reuse the live-login capture, else grab
  // it now (best-effort).
  let legacyShot: Buffer | undefined = legacyVisionShot;
  if (!legacyShot) {
    try {
      legacyShot = await captureScreenshot({
        url: opts.legacyUrl,
        viewport,
        fullPage: true,
        ...(opts.storageStatePath ? { storageStatePath: opts.storageStatePath } : {}),
      });
    } catch {
      /* best-effort — no screenshot, the model works from the rendered target text only */
    }
  }
  let lastReplicaShot: Buffer | undefined;

  const build = async ({ diffs }: BuildArgs): Promise<void> => {
    const workOrder = buildReactWorkOrder({
      atlas: opts.atlas,
      screen,
      jspSource: opts.jspSource,
      componentPath: opts.componentPath,
      renderedTarget,
      reuseAssets: reusedCss,
      endpoints: legacyEndpoints,
      crawl: crawlData,
      diffs,
    });
    const images: Array<{ data: Buffer; caption?: string }> = [];
    if (legacyShot)
      images.push({
        data: legacyShot,
        caption:
          'TARGET — the legacy screen you must reproduce EXACTLY. Match its layout, colors, fonts, ' +
          'spacing and styling, not just the text:',
      });
    if (lastReplicaShot)
      images.push({
        data: lastReplicaShot,
        caption:
          'YOUR LAST BUILD rendered like this — change your code so it matches the TARGET above:',
      });
    log(diffs ? '  ✎ fixing the flagged differences…' : '  ✎ writing the React screen…');
    const r = await buildScreen({
      gateway: opts.gateway,
      model: opts.model,
      bRepoDir: opts.appDir,
      workOrder,
      systemPrompt: REACT_SYSTEM_PROMPT,
      images: images.length ? images : undefined,
      tools: builderTools,
      // Give the agent room to do its best on one screen: more wall-clock, more no-progress
      // tolerance, and a high token budget — so a thorough reproduction is never cut off mid-write.
      guards: { maxWallClockMs: 12 * 60_000, noProgressLimit: 8, maxTokens: 400_000 },
    });
    log(`    wrote ${r.filesWritten.length} file(s) · ${r.usage.outputTokens ?? 0} out tok`);
    log(`  ⚙ ${buildCmd}…`);
    const b = runAppBuild(opts.appDir, buildCmd);
    lastBuildError = b.ok ? undefined : b.output.slice(-2000);
    log(b.ok ? '    build ok' : '    ✗ build failed');
  };

  const check = async (): Promise<ParityReport> => {
    if (lastBuildError) {
      return buildReport(
        {
          visualPct: 100,
          threshold,
          dom: [],
          style: [],
          forms: [],
          paths: [],
          build: [lastBuildError],
        },
        opts.gate,
      );
    }
    const served = await serveStatic(join(opts.appDir, serveSubdir), proxy);
    try {
      const replicaUrl = served.url + (route.startsWith('/') ? route : `/${route}`);
      log(`  🔍 checking ${replicaUrl}  vs  ${opts.legacyUrl}…`);
      // Stash the replica screenshot so the next build can SEE its own last output vs the target.
      try {
        lastReplicaShot = await captureScreenshot({ url: replicaUrl, viewport, fullPage: true });
      } catch {
        /* ignore — vision is best-effort */
      }
      return await checkParity({
        legacyUrl: opts.legacyUrl,
        replicaUrl,
        atlas: opts.atlas,
        screenKey: opts.screenKey,
        threshold,
        viewport,
        storageStatePath: opts.storageStatePath,
        gate: opts.gate,
        cachedLegacy,
        // Anti-hardcoding gate: require the replica to fetch live data through the backend proxy.
        liveData: proxy ? { contextPrefix: proxy.prefix } : undefined,
      });
    } finally {
      await served.stop();
    }
  };

  // Keep-best: snapshot the written `src` on each new best, roll back to it before a fix and at the
  // end, so the loop never finishes on a worse result than it already had.
  const srcDir = join(opts.appDir, 'src');
  const bestSnap = mkdtempSync(join(tmpdir(), 'rep-best-'));
  const snapshotBest = (iteration: number): void => {
    try {
      rmSync(bestSnap, { recursive: true, force: true });
      cpSync(srcDir, bestSnap, { recursive: true });
      log(`  ★ new best — keeping iteration ${iteration}`);
    } catch {
      /* snapshot is best-effort */
    }
  };
  const restoreBest = (): void => {
    try {
      rmSync(srcDir, { recursive: true, force: true });
      cpSync(bestSnap, srcDir, { recursive: true });
    } catch {
      /* restore is best-effort */
    }
  };

  const result = await replicateScreen({
    build,
    check,
    maxIterations: opts.maxIterations,
    onSnapshotBest: snapshotBest,
    onRestoreBest: restoreBest,
    onStep: (step) => {
      if (step.phase === 'build') log(`\n— iteration ${step.iteration} —`);
      else {
        log(`  ${printReport(step.report)}`);
        if (!step.report.matched) {
          const diffs = diffsForLlm(step.report);
          if (diffs)
            log(
              diffs
                .split('\n')
                .map((l) => `    │ ${l}`)
                .join('\n'),
            );
        }
      }
    },
  });
  // If it stopped without a match, the loop restored the best `src`, but `dist` is still the last
  // (possibly regressed) build — rebuild so the served replica + the saved shots reflect the best.
  if (!result.matched) {
    log('  ⚙ rebuilding the best-kept version…');
    runAppBuild(opts.appDir, buildCmd);
  }
  rmSync(bestSnap, { recursive: true, force: true });

  // Snap the final replica (and the original) for viewing without a browser. Named by screen key, so
  // re-running a screen overwrites it rather than leaving 20 copies.
  if (opts.shotsDir) {
    try {
      mkdirSync(opts.shotsDir, { recursive: true });
      const served = await serveStatic(join(opts.appDir, serveSubdir), proxy);
      try {
        const replicaUrl = served.url + (route.startsWith('/') ? route : `/${route}`);
        const replica = await captureScreenshot({ url: replicaUrl, viewport });
        // Original: reuse the live-login capture if we have one; else capture the legacy now.
        const original = cachedLegacy
          ? cachedLegacy.shot
          : await captureScreenshot({
              url: opts.legacyUrl,
              viewport,
              ...(opts.storageStatePath ? { storageStatePath: opts.storageStatePath } : {}),
            });
        const replicaPath = join(opts.shotsDir, `${opts.screenKey}.png`);
        const originalPath = join(opts.shotsDir, `${opts.screenKey}.original.png`);
        writeFileSync(replicaPath, replica);
        writeFileSync(originalPath, original);
        log(`\n📷 saved for viewing:`);
        log(`   replica  → ${replicaPath}`);
        log(`   original → ${originalPath}`);
      } finally {
        await served.stop();
      }
    } catch (e) {
      log(`  ⚠ couldn't save screenshots: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
