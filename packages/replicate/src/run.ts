import { join } from 'node:path';
import type { LlmGateway } from '@loom/agents';
import { captureDom, DEFAULT_VIEWPORT, type Viewport } from '@loom/browser';
import type { CodeAtlas } from '@loom/cartographer';
import { buildScreen } from '@loom/conductor';
import { DEFAULT_STYLE_PROPS } from '@loom/evaluator';
import { checkParity } from './check.js';
import { replicateScreen, type BuildArgs, type ReplicateResult } from './loop.js';
import { buildReactWorkOrder, REACT_SYSTEM_PROMPT, type JspSource } from './recipe.js';
import { runAppBuild, serveStatic } from './react-target.js';
import { serializeRendered } from './rendered.js';
import { buildReport, diffsForLlm, printReport, type ParityReport } from './report.js';

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

  const build = async ({ diffs }: BuildArgs): Promise<void> => {
    const workOrder = buildReactWorkOrder({
      atlas: opts.atlas,
      screen,
      jspSource: opts.jspSource,
      componentPath: opts.componentPath,
      renderedTarget,
      diffs,
    });
    log(diffs ? '  ✎ fixing the flagged differences…' : '  ✎ writing the React screen…');
    const r = await buildScreen({
      gateway: opts.gateway,
      model: opts.model,
      bRepoDir: opts.appDir,
      workOrder,
      systemPrompt: REACT_SYSTEM_PROMPT,
    });
    log(`    wrote ${r.filesWritten.length} file(s) · ${r.usage.outputTokens ?? 0} out tok`);
    log(`  ⚙ ${buildCmd}…`);
    const b = runAppBuild(opts.appDir, buildCmd);
    lastBuildError = b.ok ? undefined : b.output.slice(-2000);
    log(b.ok ? '    build ok' : '    ✗ build failed');
  };

  const check = async (): Promise<ParityReport> => {
    if (lastBuildError) {
      return buildReport({
        visualPct: 100,
        threshold,
        dom: [],
        style: [],
        forms: [],
        paths: [],
        build: [lastBuildError],
      });
    }
    const served = await serveStatic(join(opts.appDir, serveSubdir));
    try {
      const replicaUrl = served.url + (route.startsWith('/') ? route : `/${route}`);
      log(`  🔍 checking ${replicaUrl}  vs  ${opts.legacyUrl}…`);
      return await checkParity({
        legacyUrl: opts.legacyUrl,
        replicaUrl,
        atlas: opts.atlas,
        screenKey: opts.screenKey,
        threshold,
        viewport,
        storageStatePath: opts.storageStatePath,
      });
    } finally {
      await served.stop();
    }
  };

  return replicateScreen({
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
}
