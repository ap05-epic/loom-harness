import { describe, expect, test } from 'vitest';
import type { DomSnapshot } from '@loom/browser';
import { compareNavigation, extractNavigation, type NavLink } from './nav.js';

const dom: DomSnapshot = {
  tag: 'body',
  attrs: {},
  children: [
    { tag: 'a', attrs: { href: '/tradesAction.do' }, text: 'Trades', children: [] },
    {
      tag: 'a',
      attrs: { href: "javascript:getOverlay('filteroverlay','C0M000')" },
      text: 'NNM',
      children: [],
    },
    { tag: 'a', attrs: { href: '#' }, text: 'top', children: [] },
    { tag: 'form', attrs: { name: 'loginForm', action: '/loginAction.do' }, children: [] },
  ],
};

describe('extractNavigation', () => {
  test('classifies real links, JS actions, anchors, and forms', () => {
    const links = extractNavigation(dom);
    expect(links).toHaveLength(4);
    expect(links.find((l) => l.label === 'Trades')?.kind).toBe('navigation');
    expect(links.find((l) => l.label === 'NNM')?.kind).toBe('js-action');
    expect(links.find((l) => l.label === 'top')?.kind).toBe('anchor');
    expect(links.find((l) => l.kind === 'form-submit')?.target).toBe('/loginAction.do');
  });
});

describe('compareNavigation', () => {
  test('flags the real navigations the replica is missing; ignores JS actions', () => {
    const legacy = extractNavigation(dom);
    // Replica has the Trades link (different suffix) but not the login form.
    const replica: NavLink[] = [{ label: 'Trades', target: '/tradesAction', kind: 'navigation' }];
    const { missing, jsActions } = compareNavigation(legacy, replica);
    expect(missing.map((m) => m.target)).toContain('/loginAction.do'); // the form isn't reproduced
    expect(missing.map((m) => m.target)).not.toContain('/tradesAction.do'); // matched (suffix-insensitive)
    expect(jsActions).toHaveLength(1); // the getOverlay link is reported, not required
  });
});
