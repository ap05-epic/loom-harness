import type { DomSnapshot } from '@loom/browser';
import { describe, expect, test } from 'vitest';
import { extractLinks } from './links.js';
import {
  clickableCandidates,
  explore,
  heuristicChooser,
  type Candidate,
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
  async activate(ref: string): Promise<{ url: string; dom: DomSnapshot }> {
    this.activations += 1;
    if (this.cur === 'S0') this.cur = ref === 'a' ? 'SA' : 'SB';
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
    expect(await heuristicChooser(ctx)).toBe('2'); // the menuitem wins over a plain button
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
