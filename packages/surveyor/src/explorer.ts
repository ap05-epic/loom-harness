import type { DomSnapshot } from '@loom/browser';
import { extractLinks } from './links.js';
import { screenKey } from './state-identity.js';
import type { UiState } from './crawl.js';

/**
 * The AI-explorer: a navigator for **menu-driven apps** where `<a href>` extraction (the BFS
 * crawler) can't reach the screens — the controls are buttons, menu items, tabs, and clickable
 * divs that only navigate via JavaScript. From each state it enumerates the interactive controls,
 * a `Chooser` (an LLM in production, a heuristic offline) picks one likely to reveal a new screen,
 * it's clicked, and the resulting state is deduped by `screenKey` — bounded so an autonomous walk
 * can never run away. The `ExploreDriver` seam keeps the loop testable without a browser.
 */

/** One interactive control on a page. `ref` is opaque to the loop; the driver knows how to click it. */
export type Candidate = { ref: string; label: string; kind: string; selector?: string };

/** A captured page: its URL and normalized DOM. */
export type ExploreState = { url: string; dom: DomSnapshot };

/** The page-driving seam (a real browser in production, a fake state machine in tests). */
export interface ExploreDriver {
  /** Navigate to the start and return the initial state. */
  start(): Promise<ExploreState>;
  /** Return to the start (for backtracking when a path dead-ends). */
  reset(): Promise<ExploreState>;
  /** The interactive controls on the current page. */
  candidates(): Promise<Candidate[]>;
  /** Activate a candidate by its `ref`; returns the resulting state. */
  activate(ref: string): Promise<ExploreState>;
}

export type ChooserContext = {
  url: string;
  dom: DomSnapshot;
  /** The still-untried candidates on this state. */
  candidates: Candidate[];
  /** Screen keys already discovered (so the chooser can steer toward the unseen). */
  visitedKeys: Set<string>;
};

/** Picks the next control to click (returns its `ref`), or `null` to backtrack. */
export type Chooser = (ctx: ChooserContext) => Promise<string | null>;

export type ExploreOptions = {
  driver: ExploreDriver;
  chooser: Chooser;
  /** Cap distinct states (default 200) — a hard bound on the autonomous walk. */
  maxStates?: number;
  /** Cap total clicks (default max(maxStates×10, 200)). */
  maxVisits?: number;
};

export type ExploreResult = {
  states: UiState[];
  /** Controls activated (clicks performed). */
  visited: number;
  /** True if a budget stopped the walk before the frontier drained. */
  truncated: boolean;
};

const INTERACTIVE_ROLES = new Set([
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
const NATIVELY_INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea']);

function isInteractive(node: DomSnapshot): boolean {
  const tag = node.tag;
  const role = node.role ?? node.attrs.role;
  const href = node.attrs.href;
  if (tag === 'button' || tag === 'summary') return true;
  // Anchors WITH an href belong to the BFS crawler; only JS/menu anchors are ours.
  if (tag === 'a' && (!href || /^javascript:/i.test(href))) return true;
  if (
    tag === 'input' &&
    ['submit', 'button', 'image'].includes((node.attrs.type ?? '').toLowerCase())
  )
    return true;
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (node.attrs.onclick) return true;
  const tabindex = node.attrs.tabindex;
  if (tabindex !== undefined && tabindex !== '-1' && !NATIVELY_INTERACTIVE.has(tag)) return true;
  return false;
}

function label(node: DomSnapshot): string {
  return (
    node.text ??
    node.attrs['aria-label'] ??
    node.attrs.title ??
    node.attrs.value ??
    node.attrs.alt ??
    ''
  ).trim();
}

/** A best-effort CSS selector from stable attributes (for the live driver's fallback). */
function selectorFor(node: DomSnapshot): string | undefined {
  if (node.attrs.id) return `#${node.attrs.id}`;
  if (node.attrs.name) return `[name="${node.attrs.name}"]`;
  return undefined;
}

/**
 * The JS-interactive controls on a page — buttons, menu items, tabs, clickable divs, and
 * JavaScript anchors — i.e. exactly what `extractLinks` (href anchors) leaves out. Each gets a
 * stable `ref` (pre-order index) so a chooser can refer to it.
 */
export function clickableCandidates(dom: DomSnapshot): Candidate[] {
  const out: Candidate[] = [];
  let i = 0;
  const walk = (node: DomSnapshot): void => {
    if (isInteractive(node)) {
      out.push({
        ref: `c${i++}`,
        label: label(node),
        kind: node.role ?? node.attrs.role ?? node.tag,
        ...(selectorFor(node) ? { selector: selectorFor(node) } : {}),
      });
    }
    node.children.forEach(walk);
  };
  walk(dom);
  return out;
}

const NAV_LABEL =
  /\b(menu|nav|view|detail|list|search|account|schedule|open|tab|next|continue|go|edit|new|select|expand|more|report|pricing|credit)\b/i;

/**
 * A deterministic, LLM-free chooser: prefer a clearly-navigational control (menu item / tab /
 * link role, or a nav-ish label), else the first untried candidate. The offline fallback and the
 * baseline the LLM chooser must beat.
 */
export const heuristicChooser: Chooser = (ctx) => {
  if (ctx.candidates.length === 0) return Promise.resolve(null);
  const byRole = ctx.candidates.find((c) => INTERACTIVE_ROLES.has(c.kind) && c.kind !== 'button');
  if (byRole) return Promise.resolve(byRole.ref);
  const byLabel = ctx.candidates.find((c) => NAV_LABEL.test(c.label));
  if (byLabel) return Promise.resolve(byLabel.ref);
  return Promise.resolve(ctx.candidates[0]!.ref);
};

/**
 * Drive the explorer: depth-first from the start, clicking a chosen control, recording each new
 * (deduped) state, backtracking to the start when a path dead-ends, until the start's controls are
 * exhausted or a budget trips. The complement to the BFS `crawl` for menu-driven surfaces.
 */
export async function explore(opts: ExploreOptions): Promise<ExploreResult> {
  const maxStates = opts.maxStates ?? 200;
  const maxVisits = opts.maxVisits ?? Math.max(maxStates * 10, 200);
  const { driver, chooser } = opts;

  const states: UiState[] = [];
  const seen = new Set<string>();
  const tried = new Set<string>();
  const edge = (key: string, ref: string): string => `${key}|${ref}`;
  const record = (s: ExploreState): string => {
    const key = screenKey({ url: s.url, dom: s.dom });
    if (!seen.has(key)) {
      seen.add(key);
      states.push({ key, url: s.url, dom: s.dom, links: extractLinks(s.dom, s.url) });
    }
    return key;
  };

  let cur = await driver.start();
  const startKey = record(cur);
  let curKey = startKey;
  let visited = 0;

  while (states.length < maxStates && visited < maxVisits) {
    const cands = await driver.candidates();
    const untried = cands.filter((c) => !tried.has(edge(curKey, c.ref)));
    const ref = untried.length
      ? await chooser({ url: cur.url, dom: cur.dom, candidates: untried, visitedKeys: seen })
      : null;

    if (ref == null) {
      if (curKey === startKey) break; // root exhausted (or the chooser gave up at the root)
      cur = await driver.reset();
      curKey = record(cur);
      const rootCands = await driver.candidates();
      if (rootCands.every((c) => tried.has(edge(curKey, c.ref)))) break;
      continue;
    }

    tried.add(edge(curKey, ref));
    cur = await driver.activate(ref);
    visited += 1;
    curKey = record(cur);
  }

  return { states, visited, truncated: states.length >= maxStates || visited >= maxVisits };
}
