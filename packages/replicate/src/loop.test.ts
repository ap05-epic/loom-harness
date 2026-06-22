import { describe, expect, test, vi } from 'vitest';
import { replicateScreen } from './loop.js';
import { buildReport, type ParityReport } from './report.js';

const matched: ParityReport = buildReport({
  visualPct: 0,
  threshold: 1,
  dom: [],
  style: [],
  forms: [],
  paths: [],
});
const unmatched: ParityReport = buildReport({
  visualPct: 5,
  threshold: 1,
  dom: [],
  style: [],
  forms: [],
  paths: [{ code: 'missing_route', target: 'popup', detail: 'no link to popup' }],
});

describe('replicateScreen loop', () => {
  test('stops as soon as the checker reports 1:1', async () => {
    let checks = 0;
    const build = vi.fn(async () => {});
    const check = vi.fn(async () => (++checks >= 2 ? matched : unmatched));
    const r = await replicateScreen({ build, check, maxIterations: 6 });
    expect(r.matched).toBe(true);
    expect(r.iterations).toBe(2);
    expect(build).toHaveBeenCalledTimes(2);
  });

  test('on each retry the builder is handed ONLY the concrete diffs (none on the first build)', async () => {
    const seen: Array<string | undefined> = [];
    const build = vi.fn(async (a: { diffs?: string }) => {
      seen.push(a.diffs);
    });
    let n = 0;
    const check = vi.fn(async () => (++n >= 2 ? matched : unmatched));
    await replicateScreen({ build, check, maxIterations: 6 });
    expect(seen[0]).toBeUndefined(); // first build: from scratch, no diffs
    expect(seen[1]).toMatch(/popup/); // retry: handed the concrete diff
  });

  test('gives up at the iteration cap and returns the last (unmatched) report', async () => {
    const build = vi.fn(async () => {});
    const check = vi.fn(async () => unmatched);
    const r = await replicateScreen({ build, check, maxIterations: 3 });
    expect(r.matched).toBe(false);
    expect(r.iterations).toBe(3);
    expect(r.report.paths).toHaveLength(1);
  });
});
