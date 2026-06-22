import { CrawlSession } from '@loom/browser';

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
export async function doLogin(opts: LoginOptions): Promise<{ landedUrl: string }> {
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
    log(`  ✓ landed at ${landedUrl}`);
    await session.saveStorageState(opts.outPath);
    log(`  ✓ session saved → ${opts.outPath}`);
    return { landedUrl };
  } finally {
    await session.close();
  }
}
