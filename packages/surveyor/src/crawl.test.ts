import type { DomSnapshot } from '@loom/browser';
import { describe, expect, test } from 'vitest';
import { crawl, type VisitFn } from './crawl.js';

const node = (tag: string, extra: Partial<DomSnapshot> = {}): DomSnapshot => ({
  tag,
  attrs: {},
  children: [],
  ...extra,
});
const link = (href: string) => node('a', { attrs: { href } });

// A tiny fake site. home links to two DATA VARIANTS of the deal screen (same
// path, different query) and the list; the variants collapse to one state.
const dealDom = node('body', {
  children: [node('h1', { text: 'Deal' }), node('table', { children: [node('tr')] })],
});
const SITE: Record<string, DomSnapshot> = {
  'http://app.test/home': node('body', {
    children: [node('nav'), link('/deal?id=1'), link('/deal?id=2'), link('/list')],
  }),
  'http://app.test/deal?id=1': dealDom,
  'http://app.test/deal?id=2': dealDom, // same screen, different data
  'http://app.test/list': node('body', { children: [node('section'), node('ul')] }),
};

const visit: VisitFn = (url) => Promise.resolve({ dom: SITE[url] ?? node('body') });

describe('crawl (BFS over an injected site)', () => {
  test('discovers every reachable distinct state', async () => {
    const atlas = await crawl({ startUrl: 'http://app.test/home', visit });
    // home + deal (id=1 & id=2 collapse) + list = 3
    expect(atlas.states).toHaveLength(3);
    expect(atlas.states.map((s) => s.url)).toContain('http://app.test/home');
    expect(atlas.states.map((s) => s.url)).toContain('http://app.test/list');
  });

  test('deduplicates data-variant states (same screen, different query)', async () => {
    const atlas = await crawl({ startUrl: 'http://app.test/home', visit });
    const keys = atlas.states.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate keys
    // only one of the two /deal?id=… variants is kept as a state
    expect(atlas.states.filter((s) => s.url.includes('/deal')).length).toBe(1);
  });

  test('records each state’s outgoing links', async () => {
    const atlas = await crawl({ startUrl: 'http://app.test/home', visit });
    const home = atlas.states.find((s) => s.url === 'http://app.test/home')!;
    expect(home.links).toContain('http://app.test/deal?id=1');
    expect(home.links).toContain('http://app.test/list');
  });

  test('honours maxStates', async () => {
    const atlas = await crawl({ startUrl: 'http://app.test/home', visit, maxStates: 2 });
    expect(atlas.states).toHaveLength(2);
  });

  test('records the visit order and the start url first', async () => {
    const atlas = await crawl({ startUrl: 'http://app.test/home', visit });
    expect(atlas.states[0]!.url).toBe('http://app.test/home');
  });

  test('exclude skips destructive links (never enqueued)', async () => {
    const atlas = await crawl({
      startUrl: 'http://app.test/home',
      visit,
      exclude: (url) => url.includes('/list'),
    });
    expect(atlas.states.some((s) => s.url.includes('/list'))).toBe(false);
    expect(atlas.states.some((s) => s.url.includes('/deal'))).toBe(true);
  });

  test('reports pages visited and whether a cap truncated the crawl', async () => {
    const full = await crawl({ startUrl: 'http://app.test/home', visit });
    expect(full.truncated).toBe(false);
    expect(full.visited).toBeGreaterThanOrEqual(full.states.length);

    const capped = await crawl({ startUrl: 'http://app.test/home', visit, maxStates: 2 });
    expect(capped.states).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });
});
