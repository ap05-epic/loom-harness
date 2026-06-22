import { CrawlSession, type DomSnapshot } from '@loom/browser';

/** Flatten a DOM snapshot to its visible text — so we can see what page the login landed on. */
function flattenText(node: DomSnapshot): string {
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

export type LoginOptions = {
  /** The login page URL. */
  legacyUrl: string;
  /** Where to save the Playwright auth state (cookies/localStorage). */
  outPath: string;
  /** Fields to fill, in order (username, password, FA number, …). */
  fields: LoginField[];
  /** Selector to click to submit (default: a submit input/button). */
  submitSelector?: string;
  /** Wait for this selector after submit — proof you reached the landing page (e.g. `#pmenu`). */
  successSelector?: string;
  /** Settle delay after submit, ms (covers post-login redirects + slow menu hydration). Default 6000. */
  waitMs?: number;
  onLog?: (msg: string) => void;
};

/**
 * Log into the legacy app once and save the session, so the converter/checker can reach post‑login
 * screens with `--storage`. Deterministic (no LLM): it fills the configured fields, submits, waits
 * for the landing page, and persists cookies/localStorage. Reuses the same `CrawlSession` that already
 * authenticates the crawler — frame‑aware context, real browser.
 */
export async function doLogin(
  opts: LoginOptions,
): Promise<{ landedUrl: string; bodyText: string; looksFailed: boolean }> {
  const log = opts.onLog ?? (() => {});
  const session = new CrawlSession({});
  await session.open();
  try {
    log(`→ opening ${opts.legacyUrl}`);
    await session.navigate(opts.legacyUrl);
    for (const f of opts.fields) {
      log(`  ✎ fill ${f.selector}`);
      await session.fill(f.selector, f.value);
    }
    if (opts.submitSelector) {
      log(`  ⏎ submit (${opts.submitSelector})`);
      await session.click(opts.submitSelector);
    }
    if (opts.successSelector) {
      log(`  ⏳ waiting for ${opts.successSelector} (the landing page)…`);
      await session
        .waitForSelector(opts.successSelector)
        .catch(() => log(`    (${opts.successSelector} not found in the main frame — continuing)`));
    }
    const settleMs = opts.waitMs ?? 6000;
    log(`  ⏳ settling ${settleMs}ms for the post-login page…`);
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    const landedUrl = session.currentUrl();
    log(`  landed at ${landedUrl}`);
    let bodyText = '';
    try {
      bodyText = flattenText(await session.captureDom()).slice(0, 400);
    } catch {
      /* frameset / mid-nav — leave empty */
    }
    log(`  page says: ${bodyText || '(no visible body text — maybe a frameset)'}`);
    const looksFailed = /error|log\s?in|sign\s?in|invalid|denied/i.test(bodyText);
    if (looksFailed) {
      log(
        '  ⚠ this looks like a FAILED login (still on a login/error page) — session NOT trustworthy.',
      );
    }
    await session.saveStorageState(opts.outPath);
    log(`  ✓ session saved → ${opts.outPath}`);
    return { landedUrl, bodyText, looksFailed };
  } finally {
    await session.close();
  }
}
