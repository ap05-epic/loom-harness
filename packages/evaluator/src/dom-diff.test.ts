import { describe, expect, test } from 'vitest';
import { diffDom, type DomNode } from './dom-diff.js';

const node = (tag: string, extra: Partial<DomNode> = {}): DomNode => ({
  tag,
  attrs: {},
  children: [],
  ...extra,
});

describe('diffDom — equality', () => {
  test('identical trees produce no findings', () => {
    const a = node('form', {
      children: [node('input', { attrs: { name: 'username', type: 'text' } })],
    });
    const b = node('form', {
      children: [node('input', { attrs: { name: 'username', type: 'text' } })],
    });
    const r = diffDom(a, b);
    expect(r.matched).toBe(true);
    expect(r.findings).toEqual([]);
  });

  test('ignores presentation-only attributes (class/style/id) by default', () => {
    const a = node('div', { attrs: { class: 'a', id: 'x1', name: 'box' } });
    const b = node('div', { attrs: { class: 'b', id: 'x2', name: 'box' } });
    expect(diffDom(a, b).matched).toBe(true);
  });
});

describe('diffDom — the small things a pixel gate misses', () => {
  test('detects a missing <select> option', () => {
    const a = node('select', { attrs: { name: 'region' }, options: ['', 'EMEA', 'APAC', 'AMER'] });
    const b = node('select', { attrs: { name: 'region' }, options: ['', 'EMEA', 'APAC'] });
    const r = diffDom(a, b);
    expect(r.matched).toBe(false);
    expect(r.findings.some((f) => f.code === 'missing-option' && f.detail.includes('AMER'))).toBe(
      true,
    );
  });

  test('detects a changed input type (text vs password)', () => {
    const a = node('input', { attrs: { name: 'pw', type: 'password' } });
    const b = node('input', { attrs: { name: 'pw', type: 'text' } });
    expect(
      diffDom(a, b).findings.some((f) => f.code === 'changed-attr' && f.detail.includes('type')),
    ).toBe(true);
  });

  test('detects a missing form field', () => {
    const a = node('form', {
      children: [node('input', { attrs: { name: 'u' } }), node('input', { attrs: { name: 'p' } })],
    });
    const b = node('form', { children: [node('input', { attrs: { name: 'u' } })] });
    const r = diffDom(a, b);
    expect(r.findings.some((f) => f.code === 'missing-element')).toBe(true);
  });

  test('detects changed visible text (a relabelled control)', () => {
    const a = node('label', { text: 'User ID' });
    const b = node('label', { text: 'Username' });
    expect(diffDom(a, b).findings.some((f) => f.code === 'changed-text')).toBe(true);
  });

  test('normalizes whitespace in text before comparing', () => {
    const a = node('span', { text: 'Deal   Pipeline' });
    const b = node('span', { text: 'Deal Pipeline' });
    expect(diffDom(a, b).matched).toBe(true);
  });

  test('detects a changed link target', () => {
    const a = node('a', { attrs: { href: '/list' }, text: 'Pipeline' });
    const b = node('a', { attrs: { href: '/home' }, text: 'Pipeline' });
    expect(
      diffDom(a, b).findings.some((f) => f.code === 'changed-attr' && f.detail.includes('href')),
    ).toBe(true);
  });

  test('detects a changed tag and stops recursing into it', () => {
    const a = node('button', { children: [node('span', { text: 'Go' })] });
    const b = node('a', { children: [node('span', { text: 'Go' })] });
    const r = diffDom(a, b);
    expect(r.findings.some((f) => f.code === 'changed-tag')).toBe(true);
    expect(r.findings).toHaveLength(1);
  });

  test('reports a readable path to the offending node', () => {
    const a = node('form', {
      children: [node('select', { attrs: { name: 'region' }, options: ['EMEA'] })],
    });
    const b = node('form', {
      children: [node('select', { attrs: { name: 'region' }, options: [] })],
    });
    const finding = diffDom(a, b).findings.find((f) => f.code === 'missing-option')!;
    expect(finding.path).toContain('select');
    expect(finding.path).toContain('region');
  });
});
