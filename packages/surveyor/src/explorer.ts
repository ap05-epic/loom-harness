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

/** A captured page: its URL, normalized DOM, and (optionally) a PNG screenshot of the render. */
export type ExploreState = { url: string; dom: DomSnapshot; screenshot?: Buffer };

/** One step the explorer can take from a screen: click a control, or type a value into a field. */
export type ExploreAction =
  | { kind: 'click'; ref: string }
  | { kind: 'fill'; ref: string; value: string };

/** The page-driving seam (a real browser in production, a fake state machine in tests). */
export interface ExploreDriver {
  /** Navigate to the start and return the initial state. */
  start(): Promise<ExploreState>;
  /** Return to the start (for backtracking when a path dead-ends). */
  reset(): Promise<ExploreState>;
  /** The interactive controls on the current page. */
  candidates(): Promise<Candidate[]>;
  /** Perform an action (click a control, or fill a field) on the current page; returns the state. */
  activate(action: ExploreAction): Promise<ExploreState>;
}

/** An action the explorer performed, with the activated control's label — the session log entry. */
export type TakenStep = { action: ExploreAction; label?: string };

export type ChooserContext = {
  url: string;
  dom: DomSnapshot;
  /** The still-untried candidates on this state. */
  candidates: Candidate[];
  /** Screen keys already discovered (so the chooser can steer toward the unseen). */
  visitedKeys: Set<string>;
  /**
   * Actions already taken on THIS screen. A stateless chooser (the LLM) can't see what it already
   * typed — a filled field looks identical to an empty one — so without this it repeats its first
   * action forever. Feeding it back lets the model do the NEXT step: fill the password after the
   * username, then submit.
   */
  taken?: ExploreAction[];
  /**
   * Everything done SO FAR this session (across ALL screens), oldest first, each with the control's
   * label. Per-screen `taken` resets on every navigation, so a control that lives in a persistent
   * frame (a global Quick-Search / FA box, a menu) reappears on each screen and the model re-uses it
   * forever — re-searching, re-opening the same menu. This global view lets the chooser see it has
   * already searched / already opened that menu and pick something new instead of looping.
   */
  history?: TakenStep[];
};

/** Picks the next action (click a control / fill a field) on the current page, or `null` to backtrack. */
export type Chooser = (ctx: ChooserContext) => Promise<ExploreAction | null>;

/** One step the explorer took — surfaced live for progress + diagnostics. */
export type ExploreStep = {
  action: ExploreAction;
  /** The label of the activated control, if known (e.g. a menu item's text). */
  label?: string;
  /** Total distinct screens discovered so far. */
  discovered: number;
  /** Whether this step revealed a screen not seen before. */
  isNew: boolean;
};

export type ExploreOptions = {
  driver: ExploreDriver;
  chooser: Chooser;
  /** Cap distinct states (default 200) — a hard bound on the autonomous walk. */
  maxStates?: number;
  /** Cap total clicks (default max(maxStates×10, 200)). */
  maxVisits?: number;
  /** Called after each action — for live progress lines / diagnostics. */
  onStep?: (step: ExploreStep) => void;
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
 * A deterministic, LLM-free chooser: type a constant into the first fillable field (so an offline
 * walk still exercises forms, no secrets), else prefer a clearly-navigational control (menu item /
 * tab / link role, or a nav-ish label), else the first candidate. The offline fallback and the
 * baseline the LLM chooser must beat.
 */
export const heuristicChooser: Chooser = async (ctx) => {
  if (ctx.candidates.length === 0) return null;
  const box = ctx.candidates.find((c) => c.kind === 'textbox');
  if (box) return { kind: 'fill', ref: box.ref, value: 'loom' };
  const byRole = ctx.candidates.find((c) => INTERACTIVE_ROLES.has(c.kind) && c.kind !== 'button');
  if (byRole) return { kind: 'click', ref: byRole.ref };
  const byLabel = ctx.candidates.find((c) => NAV_LABEL.test(c.label));
  if (byLabel) return { kind: 'click', ref: byLabel.ref };
  return { kind: 'click', ref: ctx.candidates[0]!.ref };
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
  /** Actions taken per screen — fed back to the chooser so it can progress on multi-step screens. */
  const takenByScreen = new Map<string, ExploreAction[]>();
  /** Everything done this session (across screens) — feeds the chooser so it doesn't re-loop. */
  const history: TakenStep[] = [];
  const actionKey = (a: ExploreAction): string =>
    a.kind === 'fill' ? `fill:${a.ref}=${a.value}` : `click:${a.ref}`;
  const edge = (key: string, a: ExploreAction): string => `${key}|${actionKey(a)}`;
  const record = (s: ExploreState): string => {
    const key = screenKey({ url: s.url, dom: s.dom });
    if (!seen.has(key)) {
      seen.add(key);
      states.push({
        key,
        url: s.url,
        dom: s.dom,
        links: extractLinks(s.dom, s.url),
        ...(s.screenshot ? { screenshot: s.screenshot } : {}),
      });
    }
    return key;
  };

  let cur = await driver.start();
  const startKey = record(cur);
  let curKey = startKey;
  let visited = 0;

  while (states.length < maxStates && visited < maxVisits) {
    const cands = await driver.candidates();
    // Offer fillable fields always (re-fillable with a new value), clicks only until tried — so a
    // deterministic chooser exhausts the click frontier instead of re-picking a dead control.
    const offer = cands.filter(
      (c) => c.kind === 'textbox' || !tried.has(edge(curKey, { kind: 'click', ref: c.ref })),
    );
    const taken = takenByScreen.get(curKey) ?? [];
    const action = offer.length
      ? await chooser({
          url: cur.url,
          dom: cur.dom,
          candidates: offer,
          visitedKeys: seen,
          taken,
          history,
        })
      : null;

    // Backtrack on null, or on a repeat of an action already taken here (the runaway-fill guard).
    if (action == null || tried.has(edge(curKey, action))) {
      if (curKey === startKey) break; // root exhausted (or the chooser gave up at the root)
      cur = await driver.reset();
      curKey = record(cur);
      continue;
    }

    tried.add(edge(curKey, action));
    if (!takenByScreen.has(curKey)) takenByScreen.set(curKey, []);
    takenByScreen.get(curKey)!.push(action);
    const label = cands.find((c) => c.ref === action.ref)?.label;
    history.push({ action, label });
    const before = states.length;
    cur = await driver.activate(action);
    visited += 1;
    curKey = record(cur);
    opts.onStep?.({ action, label, discovered: states.length, isNew: states.length > before });
  }

  return { states, visited, truncated: states.length >= maxStates || visited >= maxVisits };
}
