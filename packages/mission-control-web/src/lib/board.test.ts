import { describe, expect, test } from 'vitest';
import { columnsFromScreens, fmtTokens, stateTone, WP_STATES, type Screen } from './board';

const screen = (over: Partial<Screen> & Pick<Screen, 'wpId' | 'state'>): Screen => ({
  screenKey: over.wpId,
  diffPercent: null,
  attempts: 1,
  ...over,
});

describe('board model', () => {
  test('WP_STATES lists the pipeline states in flow order (pending first, building before passed)', () => {
    expect(WP_STATES[0]).toBe('pending');
    expect(WP_STATES).toContain('building');
    expect(WP_STATES).toContain('passed');
    expect(WP_STATES).toContain('shipped');
    expect(WP_STATES.indexOf('building')).toBeLessThan(WP_STATES.indexOf('passed'));
  });

  test('columnsFromScreens groups screens by state, in flow order, never dropping one', () => {
    const cols = columnsFromScreens([
      screen({ wpId: '1', state: 'building' }),
      screen({ wpId: '2', state: 'passed', diffPercent: 0.4, attempts: 2 }),
      screen({ wpId: '3', state: 'building' }),
    ]);
    expect(cols.find((c) => c.state === 'building')!.screens).toHaveLength(2);
    expect(cols.find((c) => c.state === 'passed')!.screens).toHaveLength(1);
    expect(cols.findIndex((c) => c.state === 'building')).toBeLessThan(
      cols.findIndex((c) => c.state === 'passed'),
    );
  });

  test('an unknown state still gets a column (no screen is dropped)', () => {
    const cols = columnsFromScreens([screen({ wpId: 'x', state: 'quarantined' })]);
    const total = cols.reduce((n, c) => n + c.screens.length, 0);
    expect(total).toBe(1);
  });

  test('stateTone maps each state to a brand tone', () => {
    expect(stateTone('passed')).toBe('pass');
    expect(stateTone('shipped')).toBe('pass');
    expect(stateTone('failed')).toBe('fail');
    expect(stateTone('blocked')).toBe('gate');
    expect(stateTone('needs_human')).toBe('gate');
    expect(stateTone('building')).toBe('info');
    expect(stateTone('pending')).toBe('muted');
  });

  test('fmtTokens abbreviates thousands and millions', () => {
    expect(fmtTokens(950)).toBe('950');
    expect(fmtTokens(1500)).toBe('1.5k');
    expect(fmtTokens(12000)).toBe('12k');
    expect(fmtTokens(2_300_000)).toBe('2.3M');
  });
});
