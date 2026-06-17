import type { DomSnapshot } from '@loom/browser';
import { describe, expect, test } from 'vitest';
import { extractLinks } from './links.js';
import {
  clickableCandidates,
  explore,
  heuristicChooser,
  type Candidate,
  type Chooser,
  type ExploreAction,
  type ExploreDriver,
} from './explorer.js';

const el = (
  tag: string,
  attrs: Record<string, string> = {},
  text?: string,
  children: DomSnapshot[] = [],
): DomSnapshot => ({ tag, attrs, ...(text ? { text } : {}), children });
const body = (children: DomSnapshot[]): DomSnapshot => el('body', {}, undefined, children);

describe('clickableCandidates', () => {
  test('finds the JS-interactive controls that link extraction misses', () => {
    const dom = body([
      el('button', { id: 'menu' }, 'Open menu'),
      el('a', { role: 'menuitem' }, 'Accounts'), // anchor with no href — invisible to extractLinks
      el('div', { role: 'tab' }, 'Schedule C'),
      el('a', { href: '/real-link' }, 'A real link'),
    ]);

    // The href anchor is all the BFS crawler can see.
    expect(extractLinks(dom, 'http://app/')).toEqual(['http://app/real-link']);

    // The explorer sees the button, the menuitem, and the tab — the menu-driven surface.
    const labels = clickableCandidates(dom).map((c) => c.label);
    expect(labels).toContain('Open menu');
    expect(labels).toContain('Accounts');
    expect(labels).toContain('Schedule C');
    expect(labels).not.toContain('A real link'); // href anchors are left to the BFS crawler
  });

  test('assigns a stable ref and a best-effort selector', () => {
    const dom = body([el('button', { id: 'go' }, 'Go'), el('button', { name: 'next' }, 'Next')]);
    const [a, b] = clickableCandidates(dom);
    expect(a!.ref).not.toBe(b!.ref); // distinct refs
    expect(a!.selector).toBe('#go');
    expect(b!.selector).toBe('[name="next"]');
  });
});

/** A menu-driven app whose two screens are reachable ONLY by clicking buttons (no links). */
class FakeMenuApp implements ExploreDriver {
  private cur: 'S0' | 'SA' | 'SB' = 'S0';
  private readonly doms: Record<string, DomSnapshot> = {
    S0: body([el('button', { id: 'a' }, 'Open A'), el('button', { id: 'b' }, 'Open B')]),
    // Distinct screens differ in STRUCTURE (domSignature ignores text — that's the data-variant
    // collapse), so A is a heading screen and B is a form screen.
    SA: body([el('h1', {}, 'Screen A')]),
    SB: body([
      el('form', { name: 'b' }, undefined, [el('input', { type: 'text', name: 'q' }, 'Screen B')]),
    ]),
  };
  activations = 0;
  async start(): Promise<{ url: string; dom: DomSnapshot }> {
    this.cur = 'S0';
    return this.state();
  }
  async reset(): Promise<{ url: string; dom: DomSnapshot }> {
    this.cur = 'S0';
    return this.state();
  }
  async candidates(): Promise<Candidate[]> {
    return this.cur === 'S0'
      ? [
          { ref: 'a', label: 'Open A', kind: 'button' },
          { ref: 'b', label: 'Open B', kind: 'button' },
        ]
      : [];
  }
  async activate(action: ExploreAction): Promise<{ url: string; dom: DomSnapshot }> {
    this.activations += 1;
    if (action.kind === 'click' && this.cur === 'S0') this.cur = action.ref === 'a' ? 'SA' : 'SB';
    return this.state();
  }
  private state(): { url: string; dom: DomSnapshot } {
    return { url: 'http://app/', dom: this.doms[this.cur]! };
  }
}

/** Returns a chooser that plays a fixed script of actions, then backtracks (null) — mimics the LLM. */
const scripted = (script: ExploreAction[]): Chooser => {
  let i = 0;
  return () => Promise.resolve(script[i++] ?? null);
};

/** A login/search app: HOME is reachable ONLY by TYPING into a field and THEN clicking submit. */
class FakeFormApp implements ExploreDriver {
  private cur: 'LOGIN' | 'HOME' = 'LOGIN';
  private filled = false;
  private readonly doms: Record<string, DomSnapshot> = {
    LOGIN: body([
      el('input', { type: 'text', name: 'q' }, 'Login'),
      el('button', { id: 'go' }, 'Go'),
    ]),
    HOME: body([el('h1', {}, 'Home')]),
  };
  filledValue?: string;
  async start(): Promise<{ url: string; dom: DomSnapshot }> {
    this.cur = 'LOGIN';
    this.filled = false;
    return this.state();
  }
  async reset(): Promise<{ url: string; dom: DomSnapshot }> {
    this.cur = 'LOGIN'; // the login session persists — don't drop the typed state on backtrack
    return this.state();
  }
  async candidates(): Promise<Candidate[]> {
    return this.cur === 'LOGIN'
      ? [
          { ref: 'q', label: 'Search', kind: 'textbox' },
          { ref: 'go', label: 'Go', kind: 'button' },
        ]
      : [];
  }
  async activate(action: ExploreAction): Promise<{ url: string; dom: DomSnapshot }> {
    if (action.kind === 'fill' && action.ref === 'q') {
      this.filled = true;
      this.filledValue = action.value;
    } else if (action.kind === 'click' && action.ref === 'go' && this.filled) {
      this.cur = 'HOME';
    }
    return this.state();
  }
  private state(): { url: string; dom: DomSnapshot } {
    return { url: 'http://app/', dom: this.doms[this.cur]! };
  }
}

/** A two-field login: HOME needs BOTH fields typed (any order) THEN submit — the BAA shape. */
class FakeLoginApp implements ExploreDriver {
  private cur: 'LOGIN' | 'HOME' = 'LOGIN';
  private readonly filled = new Set<string>();
  filledValues: Record<string, string> = {};
  private readonly doms: Record<string, DomSnapshot> = {
    LOGIN: body([
      el('input', { type: 'text', name: 'user' }),
      el('input', { type: 'password', name: 'pass' }),
      el('input', { type: 'submit', value: 'Login' }),
    ]),
    HOME: body([el('h1', {}, 'Welcome')]),
  };
  async start(): Promise<{ url: string; dom: DomSnapshot }> {
    this.cur = 'LOGIN';
    this.filled.clear();
    return this.state();
  }
  async reset(): Promise<{ url: string; dom: DomSnapshot }> {
    this.cur = 'LOGIN'; // session persists across a backtrack
    return this.state();
  }
  async candidates(): Promise<Candidate[]> {
    return this.cur === 'LOGIN'
      ? [
          { ref: 'user', label: 'user', kind: 'textbox' },
          { ref: 'pass', label: 'pass', kind: 'textbox' },
          { ref: 'go', label: 'Login', kind: 'button' },
        ]
      : [];
  }
  async activate(action: ExploreAction): Promise<{ url: string; dom: DomSnapshot }> {
    if (action.kind === 'fill') {
      this.filled.add(action.ref);
      this.filledValues[action.ref] = action.value;
    } else if (action.ref === 'go' && this.filled.has('user') && this.filled.has('pass')) {
      this.cur = 'HOME';
    }
    return this.state();
  }
  private state(): { url: string; dom: DomSnapshot } {
    return { url: 'http://app/', dom: this.doms[this.cur]! };
  }
}

describe('explore', () => {
  test('discovers states reachable only by clicking (what synthetic URL nav cannot)', async () => {
    const driver = new FakeMenuApp();
    const result = await explore({
      driver,
      chooser: heuristicChooser,
      maxStates: 10,
      maxVisits: 10,
    });

    // start + Screen A + Screen B = 3 distinct states, found via button clicks only.
    expect(result.states).toHaveLength(3);
    expect(result.visited).toBe(2);
    expect(result.truncated).toBe(false);
    const texts = result.states.flatMap((s) => collectText(s.dom));
    expect(texts).toContain('Screen A');
    expect(texts).toContain('Screen B');
  });

  test('respects the visit budget (bounded autonomous exploration)', async () => {
    const driver = new FakeMenuApp();
    const result = await explore({
      driver,
      chooser: heuristicChooser,
      maxStates: 10,
      maxVisits: 1,
    });
    expect(result.visited).toBe(1);
    expect(result.truncated).toBe(true);
  });

  test('types into a field then submits to reach a screen (the login/search flow)', async () => {
    const driver = new FakeFormApp();
    const result = await explore({
      driver,
      chooser: scripted([
        { kind: 'fill', ref: 'q', value: '$user' },
        { kind: 'click', ref: 'go' },
      ]),
      maxStates: 10,
      maxVisits: 10,
    });

    const texts = result.states.flatMap((s) => collectText(s.dom));
    expect(texts).toContain('Home'); // reachable ONLY by fill-then-submit
    expect(driver.filledValue).toBe('$user'); // the value flows through the loop unchanged (no substitution here)
    expect(result.visited).toBe(2);
    expect(result.truncated).toBe(false);
  });

  test('completes a multi-field login using per-screen action history (taken)', async () => {
    // A stateless chooser that relies on ctx.taken to know which fields it has already filled —
    // without it, it would re-pick the first field forever and never reach submit (the live bug).
    const loginChooser: Chooser = async (ctx) => {
      const filledRefs = new Set(
        (ctx.taken ?? []).filter((a) => a.kind === 'fill').map((a) => a.ref),
      );
      const box = ctx.candidates.find((c) => c.kind === 'textbox' && !filledRefs.has(c.ref));
      if (box) return { kind: 'fill', ref: box.ref, value: box.ref === 'user' ? '$user' : '$pass' };
      const submit = ctx.candidates.find((c) => c.kind !== 'textbox');
      return submit ? { kind: 'click', ref: submit.ref } : null;
    };
    const driver = new FakeLoginApp();
    const result = await explore({ driver, chooser: loginChooser, maxStates: 10, maxVisits: 20 });

    const texts = result.states.flatMap((s) => collectText(s.dom));
    expect(texts).toContain('Welcome'); // reached HOME — only by filling BOTH fields then submitting
    expect(driver.filledValues).toEqual({ user: '$user', pass: '$pass' });
    expect(result.visited).toBe(3); // fill user, fill pass, click submit — no repeats
  });

  test('reports each step via onStep (live progress + diagnostics)', async () => {
    const driver = new FakeMenuApp();
    const steps: Array<{ kind: string; label?: string; isNew: boolean }> = [];
    await explore({
      driver,
      chooser: heuristicChooser,
      maxStates: 10,
      maxVisits: 10,
      onStep: (s) => steps.push({ kind: s.action.kind, label: s.label, isNew: s.isNew }),
    });
    // it clicked "Open A" then "Open B", each revealing a new screen
    expect(steps).toEqual([
      { kind: 'click', label: 'Open A', isNew: true },
      { kind: 'click', label: 'Open B', isNew: true },
    ]);
  });
});

describe('heuristicChooser', () => {
  test('prefers a navigational candidate, else the first untried', async () => {
    const ctx = {
      url: 'http://app/',
      dom: body([]),
      candidates: [
        { ref: '1', label: 'Delete', kind: 'button' },
        { ref: '2', label: 'Accounts', kind: 'menuitem' },
      ],
      visitedKeys: new Set<string>(),
    };
    expect(await heuristicChooser(ctx)).toEqual({ kind: 'click', ref: '2' }); // menuitem over a plain button
    expect(await heuristicChooser({ ...ctx, candidates: [] })).toBeNull();
  });
});

function collectText(dom: DomSnapshot): string[] {
  const out: string[] = [];
  const walk = (n: DomSnapshot): void => {
    if (n.text) out.push(n.text);
    n.children.forEach(walk);
  };
  walk(dom);
  return out;
}
