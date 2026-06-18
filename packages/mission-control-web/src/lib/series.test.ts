import { describe, expect, test } from 'vitest';
import { appendSample, type TokenSample } from './series';

describe('appendSample (live token-burn series)', () => {
  test('adds the first sample', () => {
    expect(appendSample([], { elapsedMs: 0, tokens: 0 })).toHaveLength(1);
  });

  test('appends a sample when tokens or elapsed advance', () => {
    const s = appendSample([{ elapsedMs: 0, tokens: 0 }], { elapsedMs: 1000, tokens: 50 });
    expect(s).toHaveLength(2);
    expect(s[1]).toEqual({ elapsedMs: 1000, tokens: 50 });
  });

  test('skips an exact duplicate (no flat repeats from re-polling the same state)', () => {
    const prev: TokenSample[] = [{ elapsedMs: 1000, tokens: 50 }];
    expect(appendSample(prev, { elapsedMs: 1000, tokens: 50 })).toBe(prev);
  });

  test('caps the series length, keeping the most recent samples', () => {
    let s: TokenSample[] = [];
    for (let i = 0; i < 300; i++) s = appendSample(s, { elapsedMs: i, tokens: i }, 50);
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s[s.length - 1]).toEqual({ elapsedMs: 299, tokens: 299 });
  });
});
