import { describe, expect, test } from 'vitest';
import { counterFor, heuristicCount } from './tokens.js';

describe('heuristicCount', () => {
  test('empty string is zero', () => {
    expect(heuristicCount('')).toBe(0);
  });

  test('approximates chars/4 with a safety margin', () => {
    expect(heuristicCount('abcd')).toBe(2); // ceil(4/4 * 1.1) = ceil(1.1)
    expect(heuristicCount('x'.repeat(400))).toBe(110); // ceil(100 * 1.1)
  });
});

describe('counterFor', () => {
  test('unknown family uses the heuristic', () => {
    const count = counterFor('unknown');
    expect(count('x'.repeat(400))).toBe(110);
  });

  test('o200k family returns a sane positive count for real text', () => {
    const count = counterFor('o200k');
    expect(count('')).toBe(0);
    // whether gpt-tokenizer is present (precise) or absent (heuristic), the
    // count for this phrase is small and positive.
    const n = count('hello world, this is a test');
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(27); // never more than ~1 token/char
  });

  test('anthropic family is callable and positive', () => {
    expect(counterFor('anthropic')('some text here')).toBeGreaterThan(0);
  });
});
