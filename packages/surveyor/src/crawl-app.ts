import { CrawlSession, type Viewport } from '@loom/browser';
import { crawl, type CrawlResult } from './crawl.js';

/** A form-login bootstrap: fill credentials once, then crawl the protected app. */
export type FormLogin = {
  url: string;
  usernameSelector: string;
  passwordSelector: string;
  username: string;
  password: string;
  submitSelector: string;
  /** Wait for this selector after submit to confirm the login landed. */
  waitForSelector?: string;
};

export type CrawlAppOptions = {
  startUrl: string;
  maxStates?: number;
  maxVisits?: number;
  /** Authenticate before crawling (the SSO/form-login bootstrap). */
  auth?: FormLogin;
  /** Skip URLs (e.g. destructive `/logout`); default skips nothing. */
  exclude?: (url: string) => boolean;
  executablePath?: string;
  viewport?: Viewport;
  /** Computed-style props to capture per state (for the evaluator's style layer). */
  styleProps?: string[];
};

/**
 * The live CRAWL: open one persistent browser session, optionally form-login,
 * then breadth-first walk the running app capturing each state's DOM. The login
 * session carries across visits, so protected screens are reachable. `exclude`
 * keeps destructive links (logout) out of the walk.
 */
export async function crawlApp(options: CrawlAppOptions): Promise<CrawlResult> {
  const session = new CrawlSession({
    executablePath: options.executablePath,
    viewport: options.viewport,
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
    return await crawl({
      startUrl: options.startUrl,
      maxStates: options.maxStates,
      maxVisits: options.maxVisits,
      exclude: options.exclude,
      visit: async (url) => {
        await session.navigate(url);
        return { dom: await session.captureDom(options.styleProps) };
      },
    });
  } finally {
    await session.close();
  }
}
