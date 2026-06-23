import { CrawlSession, type DomSnapshot, type NetworkRequest, type Viewport } from '@loom/browser';

/** Flatten a DOM snapshot to its visible text — so we can see what page we're on from the terminal. */
export function flattenText(node: DomSnapshot): string {
  const parts: string[] = [];
  const visit = (n: DomSnapshot): void => {
    if (n.text) parts.push(n.text);
    for (const c of n.children) visit(c);
  };
  visit(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** One field to fill on the login form: a CSS selector + the value (from env). */
export type LoginField = { selector: string; value: string };

/** How to log in: the login page, the fields to fill, how to submit, and how long to settle. */
export type LoginConfig = {
  loginUrl: string;
  fields: LoginField[];
  submitSelector?: string;
  successSelector?: string;
  /** Settle delay after submit, ms (post-login redirect + slow hydration). Default 6000. */
  waitMs?: number;
};

/** Whether a page's text looks like a login/error page rather than a real screen. */
export function looksLikeFailure(text: string): boolean {
  return /error|session timeout|please restart|log\s?in|sign\s?in|invalid|denied/i.test(text);
}

/** Fill the login form + submit + settle, inside an already-open session (navigates to the login page first). */
export async function loginInSession(
  session: CrawlSession,
  cfg: LoginConfig,
  log: (m: string) => void,
): Promise<void> {
  log(`→ opening ${cfg.loginUrl}`);
  await session.navigate(cfg.loginUrl);
  for (const f of cfg.fields) {
    log(`  ✎ fill ${f.selector}`);
    await session.fill(f.selector, f.value);
  }
  if (cfg.submitSelector) {
    log(`  ⏎ submit (${cfg.submitSelector})`);
    await session.click(cfg.submitSelector);
  }
  if (cfg.successSelector) {
    await session
      .waitForSelector(cfg.successSelector)
      .catch(() => log(`    (${cfg.successSelector} not found in the main frame — continuing)`));
  }
  const settleMs = cfg.waitMs ?? 6000;
  log(`  ⏳ settling ${settleMs}ms for the post-login page…`);
  await new Promise((resolve) => setTimeout(resolve, settleMs));
}

/**
 * Log in and SAVE the session to a file (the `--storage` path). Note: some apps (BAA) won't honour a
 * restored-cookie session for a cold request — for those use {@link loginAndCapture} instead, which
 * stays in one live session.
 */
export async function doLogin(
  opts: LoginConfig & { outPath: string; onLog?: (msg: string) => void },
): Promise<{ landedUrl: string; bodyText: string; looksFailed: boolean }> {
  const log = opts.onLog ?? (() => {});
  const session = new CrawlSession({});
  await session.open();
  try {
    await loginInSession(session, opts, log);
    const landedUrl = session.currentUrl();
    log(`  landed at ${landedUrl}`);
    let bodyText = '';
    try {
      bodyText = flattenText(await session.captureDom()).slice(0, 400);
    } catch {
      /* frameset / mid-nav */
    }
    log(`  page says: ${bodyText || '(no visible body text — maybe a frameset)'}`);
    const looksFailed = looksLikeFailure(bodyText);
    if (looksFailed) {
      log('  ⚠ this looks like a FAILED login (login/error page) — session NOT trustworthy.');
    }
    await session.saveStorageState(opts.outPath);
    log(`  ✓ session saved → ${opts.outPath}`);
    return { landedUrl, bodyText, looksFailed };
  } finally {
    await session.close();
  }
}

/** The FA gateway: type a test FA into the FA Number/wire box + submit to reach the real application. */
export type FaGateway = {
  /** The FA value (from env, e.g. BAA_FA). Redacted in returned endpoints; never logged in full. */
  value: string;
  /** How to find the FA box by its label (default matches "FA Number", "wire", "quick search"). */
  hint?: RegExp;
  /** Explicit submit selector, if the auto-detected submit control isn't right. */
  submitSelector?: string;
};

/** A full capture of the current screen: viewport shot (for the diff), full-page shot (vision), DOM. */
type ScreenCapture = { screenshot: Buffer; visionShot: Buffer; dom: DomSnapshot; text: string };

/** Strip an FA value (raw + URL-encoded) from a URL so it never persists in the endpoint map/logs. */
export function redactFa(url: string, fa: string): string {
  if (!fa) return url;
  return url.split(fa).join('<fa>').split(encodeURIComponent(fa)).join('<fa>');
}

/** Keep only data-bearing requests (xhr/fetch/document), redact the FA, dedupe by method+url. */
export function dataEndpoints(reqs: NetworkRequest[], fa?: string): NetworkRequest[] {
  const seen = new Set<string>();
  const out: NetworkRequest[] = [];
  for (const r of reqs) {
    if (!['xhr', 'fetch', 'document'].includes(r.resourceType)) continue;
    const url = fa ? redactFa(r.url, fa) : r.url;
    const k = `${r.method} ${url}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...r, url });
  }
  return out;
}

async function captureScreen(session: CrawlSession): Promise<ScreenCapture> {
  const [screenshot, visionShot, dom] = await Promise.all([
    session.screenshot(), // viewport — for the pixel diff (consistent size)
    session.screenshot(true), // full-page — for the model's vision (sees the whole page)
    session.captureDom(),
  ]);
  return { screenshot, visionShot, dom, text: flattenText(dom) };
}

/**
 * Enter the FA at the gateway: find the FA Number/wire box by its label (or the sole textbox), fill it,
 * and submit. Returns false (with a diagnostic) if no FA box is found — the caller then keeps the no-FA
 * capture rather than failing the run.
 */
export async function enterFaGateway(
  session: CrawlSession,
  fa: FaGateway,
  log: (m: string) => void,
): Promise<boolean> {
  const hint = fa.hint ?? /fa\s*(number|#)|wire|quick\s*search|account/i;
  const cands = await session.enumerateCandidates();
  const textboxes = cands.filter((c) => c.kind === 'textbox');
  const box =
    textboxes.find((c) => hint.test(c.label)) ??
    (textboxes.length === 1 ? textboxes[0] : undefined);
  if (!box) {
    log(
      `  ⚠ FA box not found (tune --fa-hint). textboxes: ${textboxes.map((c) => c.label).join(' | ') || '(none)'}`,
    );
    return false;
  }
  log(`  ✎ FA → ${box.label}`);
  await session.fillCandidate(box.ref, fa.value);
  if (fa.submitSelector) {
    await session.click(fa.submitSelector);
  } else {
    const submit = cands.find(
      (c) => c.kind !== 'textbox' && /submit|search|go|ok|enter|continue/i.test(c.label),
    );
    if (submit) {
      log(`  ⏎ submit (${submit.label})`);
      await session.clickCandidate(submit.ref);
    } else {
      log('  ⚠ no submit control found after FA — relying on form auto-submit');
    }
  }
  return true;
}

/**
 * Log in and, **in the same live session**, capture a screen — waiting out the mainframe load — plus
 * the backend endpoints it called. When `fa` is given, also enter the FA at the gateway and capture the
 * **FA-selected** state (the primary capture); the pre-FA capture is returned as `preFa`. The FA value
 * is redacted from the returned endpoints. This is what BAA needs: the server only trusts a live
 * session you moved within, not a restored cookie. The session is closed at the end.
 */
export async function loginAndCapture(
  opts: LoginConfig & {
    targetUrl?: string;
    viewport?: Viewport;
    onLog?: (msg: string) => void;
    fa?: FaGateway;
    loadMs?: number;
  },
): Promise<
  ScreenCapture & {
    finalUrl: string;
    endpoints: NetworkRequest[];
    preFa?: ScreenCapture;
    /** The session cookie header — so the served replica can fetch live data as this session. */
    cookieHeader: string;
  }
> {
  const log = opts.onLog ?? (() => {});
  const session = new CrawlSession(opts.viewport ? { viewport: opts.viewport } : {});
  await session.open();
  try {
    await loginInSession(session, opts, log);
    session.startNetworkLog();
    if (opts.targetUrl) {
      log(`  → navigating to target: ${opts.targetUrl}`);
      await session.navigate(opts.targetUrl);
    } else {
      log(`  → capturing the post-login landing page (no navigation)`);
    }
    log('  ⏳ waiting for the page to fully load (mainframe)…');
    await session.awaitStable(opts.loadMs);
    const landing = await captureScreen(session);

    let primary = landing;
    let preFa: ScreenCapture | undefined;
    if (opts.fa) {
      log('  🔑 entering the FA at the gateway…');
      if (await enterFaGateway(session, opts.fa, log)) {
        await session.awaitStable(opts.loadMs);
        preFa = landing;
        primary = await captureScreen(session);
        log('    captured the FA-selected state');
      }
    }
    const endpoints = dataEndpoints(session.drainNetworkLog(), opts.fa?.value);
    log(`    ${endpoints.length} data endpoint(s) recorded`);
    const cookieHeader = (await session.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    return { ...primary, finalUrl: session.currentUrl(), endpoints, preFa, cookieHeader };
  } finally {
    await session.close();
  }
}
