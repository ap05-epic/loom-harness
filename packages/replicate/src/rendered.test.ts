import { describe, expect, test } from 'vitest';
import type { DomSnapshot } from '@loom/browser';
import { serializeRendered } from './rendered.js';

describe('serializeRendered', () => {
  test('emits the rendered tags, text, and computed styles for the model', () => {
    const dom: DomSnapshot = {
      tag: 'center',
      attrs: {},
      styles: { 'font-family': 'Times New Roman', 'text-align': '-webkit-center' },
      children: [
        {
          tag: 'span',
          attrs: { class: 'label' },
          text: 'FA Number',
          styles: { color: 'rgb(0, 0, 255)', 'font-weight': '700', 'font-size': '12px' },
          children: [],
        },
      ],
    };
    const s = serializeRendered(dom);
    expect(s).toMatch(/<center/);
    expect(s).toMatch(/Times New Roman/);
    expect(s).toMatch(/FA Number/);
    expect(s).toMatch(/rgb\(0, 0, 255\)/);
    expect(s).toMatch(/font-weight: 700/);
  });

  test('caps the output so a huge page cannot blow the work order', () => {
    const big: DomSnapshot = {
      tag: 'div',
      attrs: {},
      children: Array.from({ length: 1000 }, () => ({
        tag: 'p',
        attrs: {},
        text: 'x'.repeat(40),
        children: [],
      })),
    };
    expect(serializeRendered(big, { maxChars: 800 }).length).toBeLessThan(1000);
  });
});
