import { describe, expect, test } from 'vitest';
import { diffStyles } from './style-diff.js';
import type { DomNode } from './dom-diff.js';

const node = (tag: string, extra: Partial<DomNode> = {}): DomNode => ({
  tag,
  attrs: {},
  children: [],
  ...extra,
});

describe('diffStyles', () => {
  test('identical style digests produce no findings', () => {
    const a = node('div', { styles: { color: 'rgb(0, 0, 0)', 'font-size': '11px' } });
    const b = node('div', { styles: { color: 'rgb(0, 0, 0)', 'font-size': '11px' } });
    expect(diffStyles(a, b).matched).toBe(true);
  });

  test('detects a sub-threshold font-size drift', () => {
    const a = node('div', { styles: { 'font-size': '11px' } });
    const b = node('div', { styles: { 'font-size': '12px' } });
    const r = diffStyles(a, b, { props: ['font-size'] });
    expect(r.matched).toBe(false);
    expect(r.findings.some((f) => f.prop === 'font-size' && f.detail.includes('11px'))).toBe(true);
  });

  test('detects a changed border colour (death by 1px)', () => {
    const a = node('td', { styles: { 'border-top-color': 'rgb(136, 136, 136)' } });
    const b = node('td', { styles: { 'border-top-color': 'rgb(0, 0, 0)' } });
    expect(diffStyles(a, b, { props: ['border-top-color'] }).matched).toBe(false);
  });

  test('only compares the requested properties', () => {
    const a = node('div', { styles: { color: 'red', cursor: 'pointer' } });
    const b = node('div', { styles: { color: 'red', cursor: 'default' } });
    expect(diffStyles(a, b, { props: ['color'] }).matched).toBe(true);
  });

  test('skips nodes that lack a style digest on either side', () => {
    const a = node('div', {
      styles: { color: 'red' },
      children: [node('span')],
    });
    const b = node('div', {
      styles: { color: 'red' },
      children: [node('span', { styles: { color: 'blue' } })],
    });
    expect(diffStyles(a, b).matched).toBe(true);
  });

  test('reports a readable path to the styled node', () => {
    const a = node('form', {
      children: [node('input', { attrs: { name: 'u' }, styles: { 'font-size': '11px' } })],
    });
    const b = node('form', {
      children: [node('input', { attrs: { name: 'u' }, styles: { 'font-size': '13px' } })],
    });
    const finding = diffStyles(a, b, { props: ['font-size'] }).findings[0]!;
    expect(finding.path).toContain('input');
    expect(finding.path).toContain('u');
  });
});
