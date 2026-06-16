import { describe, expect, test } from 'vitest';
import { decideNext, type NextState } from './next.js';

const ready: NextState = {
  configured: true,
  providerReady: true,
  atlasExists: true,
  latestRun: null,
  openGates: 0,
  openQuestions: 0,
  blockedWps: 0,
};

describe('decideNext', () => {
  test('no profile → init', () => {
    expect(decideNext({ ...ready, configured: false }).command).toMatch(/loom init/);
  });

  test('profile but provider not ready → models test', () => {
    expect(decideNext({ ...ready, providerReady: false }).command).toMatch(/loom models test/);
  });

  test('no atlas → map', () => {
    expect(decideNext({ ...ready, atlasExists: false }).command).toMatch(/loom map/);
  });

  test('atlas but no run → run', () => {
    expect(decideNext(ready).command).toMatch(/loom run/);
  });

  test('open gates take priority → gates list', () => {
    const step = decideNext({ ...ready, latestRun: { status: 'running' }, openGates: 2 });
    expect(step.command).toMatch(/loom gates/);
    expect(step.reason).toContain('2');
  });

  test('open questions → questions list', () => {
    expect(
      decideNext({ ...ready, latestRun: { status: 'running' }, openQuestions: 1 }).command,
    ).toMatch(/loom questions/);
  });

  test('running run with a clear inbox → watch', () => {
    expect(decideNext({ ...ready, latestRun: { status: 'running' } }).command).toMatch(
      /loom watch/,
    );
  });

  test('blocked work packages → wp list', () => {
    expect(
      decideNext({ ...ready, latestRun: { status: 'paused' }, blockedWps: 3 }).command,
    ).toMatch(/loom wp/);
  });

  test('finished run, all clear → report', () => {
    expect(decideNext({ ...ready, latestRun: { status: 'done' } }).command).toMatch(/loom report/);
  });
});
