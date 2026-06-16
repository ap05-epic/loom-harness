import { describe, expect, test } from 'vitest';
import {
  LOOM,
  LOOM_LOCKUP,
  LOOM_LOCKUP_ASCII,
  LOOM_MARK_ASCII,
  SEMANTIC,
  TAGLINE,
  tokensCss,
} from './index.js';

describe('@loom/tokens', () => {
  test('the brand hues match the brand kit', () => {
    expect(LOOM.thread).toBe('#E2A74A');
    expect(LOOM.ink).toBe('#14161F');
    // gate deliberately IS the Thread hue — the brand color is what glows for a human.
    expect(LOOM.gate).toBe(LOOM.thread);
  });

  test('semantic dark canvas is the Ink color', () => {
    expect(SEMANTIC.dark.bg).toBe(LOOM.ink);
    expect(SEMANTIC.light.bg).toBe(LOOM.paper);
  });

  test('tokensCss emits both themes and the accent var', () => {
    const css = tokensCss();
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain(`--accent:${LOOM.thread}`);
  });

  test('the lockup carries the wordmark + tagline', () => {
    expect(LOOM_LOCKUP).toContain('LOOM HARNESS');
    expect(LOOM_LOCKUP).toContain(TAGLINE);
  });

  test('the ASCII fallbacks are pure ASCII (safe on dumb terminals)', () => {
    // eslint-disable-next-line no-control-regex
    const nonAscii = /[^\x00-\x7F]/;
    expect(nonAscii.test(LOOM_MARK_ASCII)).toBe(false);
    expect(nonAscii.test(LOOM_LOCKUP_ASCII)).toBe(false);
  });
});
