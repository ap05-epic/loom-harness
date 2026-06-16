import type { DomSnapshot } from '@loom/browser';
import { describe, expect, test } from 'vitest';
import { extractLinks } from './links.js';

const node = (tag: string, extra: Partial<DomSnapshot> = {}): DomSnapshot => ({
  tag,
  attrs: {},
  children: [],
  ...extra,
});

describe('extractLinks', () => {
  const dom = node('body', {
    children: [
      node('a', { attrs: { href: '/list' } }),
      node('div', {
        children: [
          node('a', { attrs: { href: '/wizard.do' } }),
          node('a', { attrs: { href: 'https://external.example/x' } }),
        ],
      }),
      node('a', { attrs: { href: '#top' } }),
      node('a', { attrs: { href: 'javascript:void(0)' } }),
      node('a', { attrs: { href: 'mailto:x@y.z' } }),
      node('a', { attrs: { href: '/list' } }), // duplicate
    ],
  });

  test('resolves relative links against the base url', () => {
    expect(extractLinks(dom, 'http://app.test/home')).toContain('http://app.test/list');
    expect(extractLinks(dom, 'http://app.test/home')).toContain('http://app.test/wizard.do');
  });

  test('drops cross-origin, fragment, javascript, and mailto links', () => {
    const links = extractLinks(dom, 'http://app.test/home');
    expect(links.some((l) => l.includes('external.example'))).toBe(false);
    expect(links.some((l) => l.includes('#'))).toBe(false);
    expect(links.some((l) => l.startsWith('javascript'))).toBe(false);
    expect(links.some((l) => l.startsWith('mailto'))).toBe(false);
  });

  test('dedupes and strips the hash fragment', () => {
    const links = extractLinks(dom, 'http://app.test/home');
    expect(links.filter((l) => l === 'http://app.test/list')).toHaveLength(1);
  });

  test('an empty DOM yields no links', () => {
    expect(extractLinks(node('body'), 'http://app.test/')).toEqual([]);
  });
});
