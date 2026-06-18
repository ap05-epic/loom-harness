import {
  CrawlSession,
  type DomSnapshot,
  type SessionDiagnosis,
  type Viewport,
} from '@loom/browser';
import type { FormLogin } from './crawl-app.js';
import {
  explore,
  heuristicChooser,
  type Chooser,
  type ExploreDriver,
  type ExploreResult,
  type ExploreStep,
} from './explorer.js';

/** Known SSO / identity-provider hosts — a redirect here means our saved session has expired. */
const SSO_HOSTS =
  /login\.microsoftonline\.com|login\.live\.com|login\.windows\.net|\.okta\.com|accounts\.google\.com|auth0\.com|oauth2-proxy/i;

/** True if the URL is on a sign-in provider — lets a stale-cookie redirect be caught and explained. */
export function isAuthProvider(url: string): boolean {
  try {
    return SSO_HOSTS.test(new URL(url).host);
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

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
  /** ms to wait for late-AJAX controls (BAA's `#pmenu`) to appear before reading a page (default 0). */
  hydrateMs?: number;
  /** Capture a PNG screenshot of each discovered screen (the visual map / parity baseline). */
  captureScreenshots?: boolean;
  maxStates?: number;
  maxVisits?: number;
  executablePath?: string;
  viewport?: Viewport;
  /** Called after each action — live progress / diagnostics. */
  onStep?: (step: ExploreStep) => void;
  /**
   * Called with a per-frame readout of the start page when it surfaces NO controls — so a blank /
   * not-logged-in / late-hydrating start (BAA's "0 actions" symptom) is debuggable instead of silent.
   */
  onDiagnostic?: (diagnosis: SessionDiagnosis) => void;
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
    const hydrateMs = options.hydrateMs ?? 0;
    const snapshot = async (): Promise<{
      url: string;
      dom: DomSnapshot;
      screenshot?: Buffer;
    }> => {
      // Some legacy homes load their menu via AJAX after the page settles (BAA's #pmenu) — give the
      // page a bounded chance to surface interactive controls before we read it. Breaks early as soon
      // as anything is clickable/fillable, so non-hydrating pages pay nothing.
      const deadline = Date.now() + hydrateMs;
      while (Date.now() < deadline && (await session.enumerateCandidates()).length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const dom = await session.captureCombined();
      const screenshot = options.captureScreenshots ? await session.screenshot() : undefined;
      return { url: session.currentUrl(), dom, ...(screenshot ? { screenshot } : {}) };
    };
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

    // Stale-session guard: if loading the app bounces us to an SSO provider, the saved cookies have
    // expired — stop cleanly instead of letting the model try to log into Microsoft with app creds.
    await session.navigate(options.startUrl);
    const landed = session.currentUrl();
    if (isAuthProvider(landed)) {
      throw new Error(
        `saved session expired — the app redirected to a sign-in provider (${hostOf(landed)}). ` +
          'Refresh your cookies (app.cookiesPath) and run again.',
      );
    }

    // If the start page surfaces no controls at all (even after the hydration window), report what
    // DID load — blank? a login form? a logged-in home whose content frames never hydrated? — so the
    // silent "0 actions" becomes a debuggable answer.
    if (options.onDiagnostic) {
      const deadline = Date.now() + hydrateMs;
      let count = (await session.enumerateCandidates()).length;
      while (count === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        count = (await session.enumerateCandidates()).length;
      }
      if (count === 0) options.onDiagnostic(await session.diagnose());
    }

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
