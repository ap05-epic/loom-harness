import { describe, expect, test } from 'vitest';
import type { DomSnapshot } from '@loom/browser';
import { comparePaths, normalizePath, replicaNavTargets } from './paths.js';

describe('normalizePath', () => {
  test('reduces legacy action paths + replica hrefs to a comparable route slug', () => {
    expect(normalizePath('/wizard.do')).toBe('wizard');
    expect(normalizePath('/popup?id=7')).toBe('popup');
    expect(normalizePath('wizard')).toBe('wizard');
    expect(normalizePath('/BAA/jsp/list.jsp')).toBe('list');
    expect(normalizePath('https://app/x/creditLine.do?fa=ZZ99')).toBe('creditline');
  });

  test('drops non-navigations', () => {
    for (const x of ['', '#', 'javascript:void(0)', 'mailto:a@b.com', 'tel:123'])
      expect(normalizePath(x)).toBeNull();
  });
});

describe('comparePaths', () => {
  test('flags legacy routes the replica is missing', () => {
    const findings = comparePaths(['/wizard.do', '/popup'], ['/wizard']);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.target).toBe('popup');
    expect(findings[0]!.code).toBe('missing_route');
  });

  test('matches when the replica covers every legacy route (suffix/case/query-insensitive)', () => {
    expect(comparePaths(['/wizard.do', '/popup?id=1'], ['/wizard', '/POPUP'])).toEqual([]);
  });

  test('ignores duplicate legacy targets', () => {
    expect(comparePaths(['/wizard', '/wizard.do'], ['/wizard'])).toEqual([]);
  });
});

describe('replicaNavTargets', () => {
  test('collects <a href> and <form action> from the rendered DOM', () => {
    const dom: DomSnapshot = {
      tag: 'html',
      attrs: {},
      children: [
        { tag: 'a', attrs: { href: '/wizard' }, children: [] },
        {
          tag: 'div',
          attrs: {},
          children: [
            { tag: 'form', attrs: { action: '/popup' }, children: [] },
            { tag: 'a', attrs: { href: '#' }, children: [] },
          ],
        },
      ],
    };
    const targets = replicaNavTargets(dom);
    expect(targets).toContain('/wizard');
    expect(targets).toContain('/popup');
  });
});
