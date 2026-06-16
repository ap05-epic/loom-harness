import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export type Viewport = { width: number; height: number };

/** Enterprise default; legacy apps were built for ~1280-wide desktops. */
export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 1024 };

/** A normalized DOM node — structurally compatible with the evaluator's DomNode. */
export type DomSnapshot = {
  tag: string;
  role?: string;
  text?: string;
  attrs: Record<string, string>;
  options?: string[];
  styles?: Record<string, string>;
  children: DomSnapshot[];
};

/** Walk the live DOM into a normalized snapshot (runs in the browser). */
function extractDomSnapshot(styleProps: string[] | null): DomSnapshot {
  const SKIP = new Set(['script', 'style', 'noscript', 'template']);
  const extract = (el: Element): DomSnapshot => {
    const attrs: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) attrs[a.name.toLowerCase()] = a.value;
    const node: DomSnapshot = { tag: el.tagName.toLowerCase(), attrs, children: [] };
    const role = el.getAttribute('role');
    if (role) node.role = role;
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (ownText) node.text = ownText;
    if (node.tag === 'select') {
      node.options = Array.from((el as HTMLSelectElement).options).map((o) => o.value);
    }
    if (styleProps) {
      const cs = getComputedStyle(el);
      const styles: Record<string, string> = {};
      for (const p of styleProps) styles[p] = cs.getPropertyValue(p);
      node.styles = styles;
    }
    node.children = Array.from(el.children)
      .filter((c) => !SKIP.has(c.tagName.toLowerCase()))
      .map(extract);
    return node;
  };
  return extract(document.body);
}

/** Tag and list the page's JS-interactive controls (the AI-explorer's candidates). Runs in-page. */
function enumerateInteractive(): Array<{ ref: string; label: string; kind: string }> {
  const ROLES = new Set([
    'button',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'tab',
    'option',
    'switch',
    'link',
    'treeitem',
  ]);
  const NATIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
  const interactive = (el: Element): boolean => {
    const tag = el.tagName;
    const role = el.getAttribute('role');
    const href = el.getAttribute('href');
    if (tag === 'BUTTON' || tag === 'SUMMARY') return true;
    if (tag === 'A' && (!href || /^javascript:/i.test(href))) return true;
    if (
      tag === 'INPUT' &&
      ['submit', 'button', 'image'].includes((el.getAttribute('type') ?? '').toLowerCase())
    )
      return true;
    if (role && ROLES.has(role)) return true;
    if (el.getAttribute('onclick')) return true;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && ti !== '-1' && !NATIVE.has(tag)) return true;
    return false;
  };
  const out: Array<{ ref: string; label: string; kind: string }> = [];
  let i = 0;
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (!interactive(el)) continue;
    el.setAttribute('data-loom-cand', String(i));
    const label = (
      el.textContent ??
      el.getAttribute('aria-label') ??
      el.getAttribute('title') ??
      el.getAttribute('value') ??
      el.getAttribute('alt') ??
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    out.push({ ref: String(i), label, kind: el.getAttribute('role') ?? el.tagName.toLowerCase() });
    i++;
  }
  return out;
}

export type CaptureOptions = {
  url: string;
  viewport?: Viewport;
  fullPage?: boolean;
  /** Reuse a saved auth state (cookies/localStorage) — the SSO bootstrap path. */
  storageStatePath?: string;
  waitForSelector?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  /** When set, captureDom records each element's computed values for these CSS props. */
  styleProps?: string[];
};

export type SessionOptions = {
  /** Pod-provided Chromium, when the bundled browser isn't available. */
  executablePath?: string;
};

/** A reusable browser for capturing several pages without relaunching. */
export class BrowserSession {
  private browser?: Browser;
  constructor(private readonly options: SessionOptions = {}) {}

  async open(): Promise<void> {
    this.browser = await chromium.launch({ executablePath: this.options.executablePath });
  }

  async capture(options: CaptureOptions): Promise<Buffer> {
    if (!this.browser) throw new Error('BrowserSession is not open — call open() first');
    const context = await this.browser.newContext({
      viewport: options.viewport ?? DEFAULT_VIEWPORT,
      storageState: options.storageStatePath,
    });
    try {
      const page = await context.newPage();
      await page.goto(options.url, { waitUntil: options.waitUntil ?? 'networkidle' });
      if (options.waitForSelector) await page.waitForSelector(options.waitForSelector);
      return await page.screenshot({ fullPage: options.fullPage ?? false });
    } finally {
      await context.close();
    }
  }

  /** Capture a normalized DOM snapshot — the structural evaluator's input. */
  async captureDom(options: CaptureOptions): Promise<DomSnapshot> {
    if (!this.browser) throw new Error('BrowserSession is not open — call open() first');
    const context = await this.browser.newContext({
      viewport: options.viewport ?? DEFAULT_VIEWPORT,
      storageState: options.storageStatePath,
    });
    try {
      const page = await context.newPage();
      await page.goto(options.url, { waitUntil: options.waitUntil ?? 'networkidle' });
      if (options.waitForSelector) await page.waitForSelector(options.waitForSelector);
      return await page.evaluate(extractDomSnapshot, options.styleProps ?? null);
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }
}

export type CrawlSessionOptions = SessionOptions & {
  viewport?: Viewport;
  /** Reuse a saved auth state (the SSO bootstrap) for the whole session. */
  storageStatePath?: string;
};

/**
 * A single, persistent browser context for crawling — unlike `BrowserSession`
 * (fresh context per capture), here one context + page are reused across
 * navigations so **login cookies/session carry over**. This is what lets the
 * surveyor authenticate once and then walk the protected screens.
 */
export class CrawlSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  constructor(private readonly options: CrawlSessionOptions = {}) {}

  async open(): Promise<void> {
    this.browser = await chromium.launch({ executablePath: this.options.executablePath });
    this.context = await this.browser.newContext({
      viewport: this.options.viewport ?? DEFAULT_VIEWPORT,
      storageState: this.options.storageStatePath,
    });
    this.page = await this.context.newPage();
  }

  private active(): Page {
    if (!this.page) throw new Error('CrawlSession is not open — call open() first');
    return this.page;
  }

  async navigate(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle',
  ): Promise<void> {
    await this.active().goto(url, { waitUntil });
  }

  currentUrl(): string {
    return this.active().url();
  }

  async captureDom(styleProps?: string[]): Promise<DomSnapshot> {
    return this.active().evaluate(extractDomSnapshot, styleProps ?? null);
  }

  async screenshot(): Promise<Buffer> {
    return this.active().screenshot();
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.active().fill(selector, value);
  }

  async click(selector: string): Promise<void> {
    await this.active().click(selector);
  }

  async waitForSelector(selector: string): Promise<void> {
    await this.active().waitForSelector(selector);
  }

  /** Tag and return the page's interactive controls — the AI-explorer's candidate list. */
  async enumerateCandidates(): Promise<Array<{ ref: string; label: string; kind: string }>> {
    return this.active().evaluate(enumerateInteractive);
  }

  /** Click a control previously returned by `enumerateCandidates`, by its ref. */
  async clickCandidate(ref: string): Promise<void> {
    const page = this.active();
    await page.click(`[data-loom-cand="${ref}"]`);
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }

  /** Persist cookies/localStorage so a later run can skip the login. */
  async saveStorageState(path: string): Promise<void> {
    await this.context?.storageState({ path });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
  }
}

/** Capture one screenshot, opening and closing a browser around it. */
export async function captureScreenshot(options: CaptureOptions & SessionOptions): Promise<Buffer> {
  const session = new BrowserSession({ executablePath: options.executablePath });
  await session.open();
  try {
    return await session.capture(options);
  } finally {
    await session.close();
  }
}

/** Capture one DOM snapshot, opening and closing a browser around it. */
export async function captureDom(options: CaptureOptions & SessionOptions): Promise<DomSnapshot> {
  const session = new BrowserSession({ executablePath: options.executablePath });
  await session.open();
  try {
    return await session.captureDom(options);
  } finally {
    await session.close();
  }
}

/** Probe whether a browser can launch — used to gate browser-dependent tests/checks. */
export async function canLaunchBrowser(executablePath?: string): Promise<boolean> {
  try {
    const browser = await chromium.launch({ executablePath });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}
