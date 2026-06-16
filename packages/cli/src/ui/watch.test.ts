import { describe, expect, test } from 'vitest';
import { renderWatchFrame, type WatchFrameInput } from './watch.js';

const base: WatchFrameInput = {
  version: '1.0.0',
  project: 'fixture',
  run: { id: 'run_abc', status: 'running', stage: 'build' },
  screens: [
    { screenKey: 'login', state: 'passed' },
    { screenKey: 'list', state: 'passed' },
    { screenKey: 'wizard', state: 'building' },
    { screenKey: 'popup', state: 'blocked' },
  ],
  tokens: 1_234_567,
  gatesOpen: 1,
  questionsOpen: 0,
  heartbeatAgeMs: 12_000,
  recent: [{ ts: '2026-06-16T12:00:01.000Z', type: 'wp.passed', wpId: 'wp_login' }],
};

describe('renderWatchFrame', () => {
  test('renders the run header, screen tally, budgets and recent events', () => {
    const frame = renderWatchFrame(base);
    expect(frame).toContain('loom 1.0.0');
    expect(frame).toContain('fixture');
    expect(frame).toContain('run_abc');
    expect(frame).toContain('build'); // stage
    // screen tally by state
    expect(frame).toMatch(/2[^\n]*passed/);
    expect(frame).toMatch(/1[^\n]*building/);
    expect(frame).toMatch(/1[^\n]*blocked/);
    // budgets + inbox
    expect(frame).toMatch(/1\.2M|1234567|1,234,567/);
    expect(frame).toMatch(/1[^\n]*gate/i);
    // recent feed
    expect(frame).toContain('wp.passed');
  });

  test('flags a stale heartbeat as possibly wedged', () => {
    const stale = renderWatchFrame({
      ...base,
      heartbeatAgeMs: 7 * 60_000,
      stalenessMs: 6 * 60_000,
    });
    expect(stale.toLowerCase()).toContain('wedged');
    const fresh = renderWatchFrame({ ...base, heartbeatAgeMs: 5_000, stalenessMs: 6 * 60_000 });
    expect(fresh.toLowerCase()).not.toContain('wedged');
  });

  test('degrades gracefully when there is no active run', () => {
    const frame = renderWatchFrame({
      version: '1.0.0',
      project: 'fixture',
      run: null,
      screens: [],
      tokens: null,
      gatesOpen: 0,
      questionsOpen: 0,
      heartbeatAgeMs: null,
      recent: [],
    });
    expect(frame.toLowerCase()).toContain('no active run');
  });
});
