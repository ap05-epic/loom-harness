import { describe, expect, test } from 'vitest';
import { scoreVisual, type StateDiff } from './scorecard.js';

const d = (state: string, diffPercent: number, viewport = 'desktop'): StateDiff => ({
  state,
  viewport,
  diffPercent,
});

describe('scoreVisual (the visual-parity verdict)', () => {
  test('identical capture (all 0%) passes', () => {
    const v = scoreVisual([d('login', 0), d('list', 0)], { threshold: 1 });
    expect(v.passed).toBe(true);
    expect(v.failures).toHaveLength(0);
    expect(v.worst.diffPercent).toBe(0);
  });

  test('all states under threshold pass (faithful rebuild)', () => {
    const v = scoreVisual([d('login', 0.4), d('list', 0.9)], { threshold: 1 });
    expect(v.passed).toBe(true);
    expect(v.worst.state).toBe('list');
  });

  test('a single state over threshold fails, naming the offending state', () => {
    const v = scoreVisual([d('login', 0.2), d('list', 5)], { threshold: 1 });
    expect(v.passed).toBe(false);
    expect(v.failures.map((f) => f.state)).toEqual(['list']);
    expect(v.worst.state).toBe('list');
    expect(v.worst.diffPercent).toBe(5);
  });

  test('exactly at threshold passes (inclusive)', () => {
    expect(scoreVisual([d('x', 1)], { threshold: 1 }).passed).toBe(true);
  });

  test('per-state threshold overrides the default', () => {
    const v = scoreVisual([d('chart', 2.5)], {
      threshold: 1,
      perStateThreshold: { chart: 3 },
    });
    expect(v.passed).toBe(true);
  });

  test('per-viewport failures are reported independently', () => {
    const v = scoreVisual([d('login', 0.1, 'desktop'), d('login', 4, 'mobile')], { threshold: 1 });
    expect(v.passed).toBe(false);
    expect(v.failures).toEqual([{ state: 'login', viewport: 'mobile', diffPercent: 4 }]);
  });

  test('empty input is a vacuous pass with a zero worst', () => {
    const v = scoreVisual([], { threshold: 1 });
    expect(v.passed).toBe(true);
    expect(v.worst.diffPercent).toBe(0);
  });
});
