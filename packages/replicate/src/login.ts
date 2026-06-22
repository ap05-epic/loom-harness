import { CrawlSession, type DomSnapshot, type Viewport } from '@loom/browser';

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
async function loginInSession(
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

/**
 * Log in and, **in the same live session**, navigate to a target URL and capture it — screenshot +
 * DOM. This is what BAA needs: the server only trusts a session you established live and then moved
 * within, not a restored cookie. The session is closed at the end.
 */
export async function loginAndCapture(
  opts: LoginConfig & { targetUrl?: string; viewport?: Viewport; onLog?: (msg: string) => void },
): Promise<{
  screenshot: Buffer;
  visionShot: Buffer;
  dom: DomSnapshot;
  text: string;
  finalUrl: string;
}> {
  const log = opts.onLog ?? (() => {});
  const session = new CrawlSession(opts.viewport ? { viewport: opts.viewport } : {});
  await session.open();
  try {
    await loginInSession(session, opts, log);
    if (opts.targetUrl) {
      log(`  → navigating to target: ${opts.targetUrl}`);
      await session.navigate(opts.targetUrl);
      await new Promise((resolve) => setTimeout(resolve, 3000)); // let the target settle
    } else {
      log(`  → capturing the post-login landing page (no navigation)`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const [screenshot, visionShot, dom] = await Promise.all([
      session.screenshot(), // viewport — for the pixel diff (consistent size)
      session.screenshot(true), // full-page — for the model's vision (sees the whole page)
      session.captureDom(),
    ]);
    return { screenshot, visionShot, dom, text: flattenText(dom), finalUrl: session.currentUrl() };
  } finally {
    await session.close();
  }
}
