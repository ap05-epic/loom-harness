import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmGateway } from '@loom/agents';
import {
  captureDom,
  captureScreenshot,
  DEFAULT_VIEWPORT,
  type DomSnapshot,
  type Viewport,
} from '@loom/browser';
import type { CodeAtlas } from '@loom/cartographer';
import { buildScreen } from '@loom/conductor';
import { DEFAULT_STYLE_PROPS } from '@loom/evaluator';
import { checkParity } from './check.js';
import { loginAndCapture, type LoginConfig } from './login.js';
import { replicateScreen, type BuildArgs, type ReplicateResult } from './loop.js';
import { buildReactWorkOrder, REACT_SYSTEM_PROMPT, type JspSource } from './recipe.js';
import { runAppBuild, serveStatic } from './react-target.js';
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

  // Pre-read the live legacy screen once: its rendered tags + the exact computed styles the checker
  // measures. This is the most precise target we can hand the model — better than the JSP template
  // alone. Best-effort: if the legacy isn't reachable, fall back to JSP source only.
  let renderedTarget: string | undefined;
  let cachedLegacy: { shot: Buffer; dom: DomSnapshot } | undefined;
  if (opts.login) {
    // Log in and capture the legacy screen in ONE live session; reuse it every iteration.
    log('  🔑 logging in + capturing the legacy screen (one live session)…');
    const cap = await loginAndCapture({ ...opts.login, viewport, onLog: log });
    cachedLegacy = { shot: cap.screenshot, dom: cap.dom };
    renderedTarget = serializeRendered(cap.dom);
    log(
      `    captured the legacy screen (${renderedTarget.length} chars; ended at ${cap.finalUrl})`,
    );
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

  // The legacy screenshot (the visual TARGET) — fed to the model so it can SEE the screen, not just
  // read its structure. Reuse the live-login capture, else grab it now (best-effort).
  let legacyShot: Buffer | undefined = cachedLegacy?.shot;
  if (!legacyShot) {
    try {
      legacyShot = await captureScreenshot({
        url: opts.legacyUrl,
        viewport,
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
    const served = await serveStatic(join(opts.appDir, serveSubdir));
    try {
      const replicaUrl = served.url + (route.startsWith('/') ? route : `/${route}`);
      log(`  🔍 checking ${replicaUrl}  vs  ${opts.legacyUrl}…`);
      // Stash the replica screenshot so the next build can SEE its own last output vs the target.
      try {
        lastReplicaShot = await captureScreenshot({ url: replicaUrl, viewport });
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
      });
    } finally {
      await served.stop();
    }
  };

  const result = await replicateScreen({
    build,
    check,
    maxIterations: opts.maxIterations,
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

  // Snap the final replica (and the original) for viewing without a browser. Named by screen key, so
  // re-running a screen overwrites it rather than leaving 20 copies.
  if (opts.shotsDir) {
    try {
      mkdirSync(opts.shotsDir, { recursive: true });
      const served = await serveStatic(join(opts.appDir, serveSubdir));
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
