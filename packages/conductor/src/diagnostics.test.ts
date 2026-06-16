import { describe, expect, test } from 'vitest';
import { classifyActivity } from './diagnostics.js';

const MIN = 60_000;

describe('classifyActivity', () => {
  test('active when recently progressing and not yet long-running', () => {
    expect(classifyActivity({ elapsedMs: 30_000, idleMs: 5_000 })).toBe('active');
  });

  test('long_running when elapsed is high but it is still progressing', () => {
    expect(classifyActivity({ elapsedMs: 4 * MIN, idleMs: 10_000 })).toBe('long_running');
  });

  test('stalled when idle past the stalled threshold', () => {
    expect(classifyActivity({ elapsedMs: 6 * MIN, idleMs: 6 * MIN })).toBe('stalled');
  });

  test('stuck when idle past the stuck threshold (abort candidate)', () => {
    expect(classifyActivity({ elapsedMs: 12 * MIN, idleMs: 11 * MIN })).toBe('stuck');
  });

  test('respects custom thresholds', () => {
    expect(classifyActivity({ elapsedMs: 0, idleMs: 100, thresholds: { stuckMs: 50 } })).toBe(
      'stuck',
    );
  });
});
