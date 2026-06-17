import { CrawlSession, type DomSnapshot, type Viewport } from '@loom/browser';
import type { FormLogin } from './crawl-app.js';
import {
  explore,
  heuristicChooser,
  type Chooser,
  type ExploreDriver,
  type ExploreResult,
  type ExploreStep,
} from './explorer.js';

export type ExploreAppOptions = {
  startUrl: string;
  /** Picks the next control to click (an LLM-backed chooser in production); default heuristic. */
  chooser?: Chooser;
  /** Authenticate before exploring (form-login bootstrap). */
  auth?: FormLogin;
  /** Reuse a saved auth state (the SSO bootstrap) instead of a form login. */
  storageStatePath?: string;
  /** Path to a JSON array of Playwright cookies (an SSO session), applied fresh each run. */
  cookiesPath?: string;
  /**
   * Secret values the chooser may reference by name: a fill `value` of `$user` is replaced with
   * `secrets.user` here, in the driver — so credentials/FA codes are typed into the page but never
   * placed in the chooser's prompt. Keyed without the `$`.
   */
  secrets?: Record<string, string>;
  maxStates?: number;
  maxVisits?: number;
  executablePath?: string;
  viewport?: Viewport;
  /** Called after each action — live progress / diagnostics. */
  onStep?: (step: ExploreStep) => void;
};

/**
 * The live AI-explorer: open one persistent (logged-in) browser session and let `explore` walk the
 * app by **clicking** its menu/button/tab controls — the screens BFS link-crawling can't reach.
 * The `CrawlSession` seam supplies in-page candidate enumeration (`enumerateCandidates`) and
 * click-by-ref (`clickCandidate`); the chooser decides which control to click each step.
 */
export async function exploreApp(options: ExploreAppOptions): Promise<ExploreResult> {
  const session = new CrawlSession({
    executablePath: options.executablePath,
    viewport: options.viewport,
    storageStatePath: options.storageStatePath,
    cookiesPath: options.cookiesPath,
  });
  await session.open();
  try {
    if (options.auth) {
      const a = options.auth;
      await session.navigate(a.url);
      await session.fill(a.usernameSelector, a.username);
      await session.fill(a.passwordSelector, a.password);
      await session.click(a.submitSelector);
      if (a.waitForSelector) await session.waitForSelector(a.waitForSelector);
    }

    // Combine all frames so the explorer's screen identity tracks the CONTENT (BAA's screens live in
    // frameset child frames), not the static shell — and so a bodyless frameset doc doesn't crash.
    const snapshot = async (): Promise<{ url: string; dom: DomSnapshot }> => ({
      url: session.currentUrl(),
      dom: await session.captureCombined(),
    });
    // The ONLY place a `$secret` placeholder becomes a real value — downstream of the chooser.
    const secrets = options.secrets ?? {};
    const resolveValue = (v: string): string =>
      v.startsWith('$') ? (secrets[v.slice(1)] ?? '') : v;
    const driver: ExploreDriver = {
      start: async () => {
        await session.navigate(options.startUrl);
        return snapshot();
      },
      reset: async () => {
        await session.navigate(options.startUrl);
        return snapshot();
      },
      candidates: () => session.enumerateCandidates(),
      activate: async (action) => {
        if (action.kind === 'fill')
          await session.fillCandidate(action.ref, resolveValue(action.value));
        else await session.clickCandidate(action.ref);
        return snapshot();
      },
    };

    return await explore({
      driver,
      chooser: options.chooser ?? heuristicChooser,
      maxStates: options.maxStates,
      maxVisits: options.maxVisits,
      onStep: options.onStep,
    });
  } finally {
    await session.close();
  }
}
