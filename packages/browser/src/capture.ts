import axe from 'axe-core';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright';

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

/**
 * Tag and list a frame's fillable fields + JS-interactive controls (the AI-explorer's candidates).
 * Runs in-page. Fillable inputs/textarea/select are tagged `kind: 'textbox'` so the explorer can
 * TYPE into them (login, search); everything else is a clickable control.
 */
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
  // <input> types we can type a value into (everything that isn't a button/checkbox/etc.).
  const FILLABLE_INPUT = new Set([
    'text',
    'email',
    'password',
    'search',
    'tel',
    'url',
    'number',
    '',
  ]);
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
  const fillable = (el: Element): boolean => {
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return FILLABLE_INPUT.has((el.getAttribute('type') ?? '').toLowerCase());
    return false;
  };
  const out: Array<{ ref: string; label: string; kind: string }> = [];
  let i = 0;
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const isFill = fillable(el);
    const isClick = interactive(el);
    if (!isFill && !isClick) continue;
    el.setAttribute('data-loom-cand', String(i));
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const attr = (
      el.getAttribute('aria-label') ??
      el.getAttribute('placeholder') ??
      el.getAttribute('name') ??
      el.getAttribute('title') ??
      el.getAttribute('value') ??
      el.getAttribute('alt') ??
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    // Clickables read best from their text ("Login"); fillable fields have none, so prefer attrs.
    const label = (isFill ? attr || text : text || attr).slice(0, 120);
    const kind = isFill ? 'textbox' : (el.getAttribute('role') ?? el.tagName.toLowerCase());
    out.push({ ref: String(i), label, kind });
    i++;
  }
  return out;
}

/** True for the transient "the page navigated out from under an evaluate/read" Playwright errors. */
function isContextDestroyed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /context was destroyed|frame (was|got) detached|target closed/i.test(message);
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

  /** Best-effort wait for the page to settle after an action that may or may not have navigated. */
  private async settle(): Promise<void> {
    const page = this.active();
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }

  async captureDom(styleProps?: string[]): Promise<DomSnapshot> {
    try {
      return await this.active().evaluate(extractDomSnapshot, styleProps ?? null);
    } catch (error) {
      if (!isContextDestroyed(error)) throw error;
      // A navigation tore down the context mid-read — wait for the new page, then read it.
      await this.settle();
      return await this.active().evaluate(extractDomSnapshot, styleProps ?? null);
    }
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

  /**
   * Tag and return the interactive controls + fillable fields across EVERY frame — the AI-explorer's
   * candidate list. Each `ref` is prefixed with its frame index (`"<frameIdx>:<local>"`) so a later
   * `clickCandidate`/`fillCandidate` targets the right frame; frameset apps (BAA login + menus) hide
   * whole controls inside child frames a main-frame-only enumerate would miss.
   */
  async enumerateCandidates(): Promise<Array<{ ref: string; label: string; kind: string }>> {
    const frames = this.active().frames();
    const out: Array<{ ref: string; label: string; kind: string }> = [];
    for (let fi = 0; fi < frames.length; fi++) {
      try {
        const local = await frames[fi]!.evaluate(enumerateInteractive);
        for (const c of local) out.push({ ...c, ref: `${fi}:${c.ref}` });
      } catch {
        // cross-origin / detached frame, or one navigating mid-read — contributes no candidates
      }
    }
    return out;
  }

  /** Resolve a frame-prefixed candidate ref to its frame + selector (bare ref ⇒ main frame). */
  private resolveRef(ref: string): { frame: Frame; selector: string } {
    const idx = ref.indexOf(':');
    const fi = idx === -1 ? 0 : Number(ref.slice(0, idx));
    const local = idx === -1 ? ref : ref.slice(idx + 1);
    const frames = this.active().frames();
    return {
      frame: frames[fi] ?? this.active().mainFrame(),
      selector: `[data-loom-cand="${local}"]`,
    };
  }

  /**
   * Trigger a control previously returned by `enumerateCandidates`, by its frame-prefixed ref.
   * Uses `dispatchEvent('click')` (≡ `element.click()`) rather than a coordinate click: it fires the
   * control's handler / `javascript:` href / form-submit directly, regardless of overlays — legacy
   * flyout menus (BAA's qpmenu) render an open submenu on top of their own links, which a real mouse
   * click can't reach ("`<ul> intercepts pointer events`"). We only need to activate the control, not
   * simulate a mouse, so this is more robust and frees us from opening menus visually.
   */
  async clickCandidate(ref: string): Promise<void> {
    const { frame, selector } = this.resolveRef(ref);
    await frame.dispatchEvent(selector, 'click');
    // The click may trigger a navigation (a menu action, a form submit) — wait for it to land so the
    // caller's next read isn't torn down mid-navigation.
    await this.settle();
  }

  /** Type into (or, for a <select>, choose) a fillable candidate, by its frame-prefixed ref. */
  async fillCandidate(ref: string, value: string): Promise<void> {
    const { frame, selector } = this.resolveRef(ref);
    const handle = await frame.$(selector);
    if (!handle) throw new Error(`fillCandidate: no element for ref ${ref}`);
    const tag = (await handle.evaluate((el) => el.tagName)).toLowerCase();
    if (tag === 'select') await frame.selectOption(selector, value);
    else await frame.fill(selector, value);
  }

  /** Run axe-core in the page and return its violations — the a11y layer's input. */
  async captureA11y(): Promise<Array<{ id: string; impact?: string; count: number }>> {
    const page = this.active();
    await page.addScriptTag({ content: axe.source });
    return page.evaluate(async () => {
      const w = window as unknown as {
        axe: {
          run: (
            ctx: Document,
          ) => Promise<{ violations: Array<{ id: string; impact?: string; nodes: unknown[] }> }>;
        };
      };
      const result = await w.axe.run(document);
      return result.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length }));
    });
  }

  /**
   * Capture the main document and every child frame as separate normalized DOMs, each with a
   * `framePath` (the frame's name or URL path). Frameset/iframe apps (e.g. a legacy Tiles frameset)
   * hide whole screens inside frames that a single document capture misses.
   */
  async captureFrames(
    styleProps?: string[],
  ): Promise<Array<{ framePath: string; dom: DomSnapshot }>> {
    const page = this.active();
    const out: Array<{ framePath: string; dom: DomSnapshot }> = [];
    for (const frame of page.frames()) {
      const dom = await frame.evaluate(extractDomSnapshot, styleProps ?? null);
      const framePath =
        frame === page.mainFrame()
          ? ''
          : frame.name() ||
            (() => {
              try {
                return new URL(frame.url()).pathname;
              } catch {
                return frame.url();
              }
            })();
      out.push({ framePath, dom });
    }
    return out;
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
