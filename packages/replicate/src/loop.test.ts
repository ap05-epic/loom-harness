import { describe, expect, test, vi } from 'vitest';
import { isBetter, replicateScreen } from './loop.js';
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

const rep = (visualPct: number, extra: Partial<ParityReport> = {}): ParityReport =>
  buildReport({ visualPct, threshold: 1, dom: [], style: [], forms: [], paths: [], ...extra });

describe('keep-best (never regress)', () => {
  test('returns the BEST iteration, not the last (worse) one', async () => {
    const seq = [rep(10), rep(30), rep(25)]; // iter1 best, then two regressions
    let i = 0;
    let snapshots = 0;
    let restores = 0;
    const r = await replicateScreen({
      build: async () => {},
      check: async () => seq[i++]!,
      maxIterations: 3,
      onSnapshotBest: () => {
        snapshots++;
      },
      onRestoreBest: () => {
        restores++;
      },
    });
    expect(r.report.visualPct).toBe(10); // the best, never the last (25)
    expect(r.iterations).toBe(3);
    expect(snapshots).toBe(1); // only iteration 1 was ever the best
    expect(restores).toBeGreaterThanOrEqual(2); // rolled back before each fix + at the end
  });

  test("fixes are handed the BEST report's diffs, not the regression's", async () => {
    const best = rep(10, { paths: [{ code: 'missing_route', target: 'fromBest', detail: 'x' }] });
    const worse = rep(40, { paths: [{ code: 'missing_route', target: 'fromWorse', detail: 'y' }] });
    const seq = [best, worse, worse];
    let i = 0;
    const seen: Array<string | undefined> = [];
    await replicateScreen({
      build: async (a) => {
        seen.push(a.diffs);
      },
      check: async () => seq[i++]!,
      maxIterations: 3,
    });
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toMatch(/fromBest/); // fix #1 targets the best's diff
    expect(seen[2]).toMatch(/fromBest/); // fix #2 still from best (iter2 regressed, discarded)
    expect(seen[2]).not.toMatch(/fromWorse/);
  });
});

describe('isBetter', () => {
  test('a 1:1 match beats anything', () => {
    expect(isBetter(matched, rep(50))).toBe(true);
    expect(isBetter(rep(50), matched)).toBe(false);
  });
  test('a build error is worse than any non-build-error', () => {
    expect(isBetter(rep(80), rep(5, { build: ['boom'] }))).toBe(true);
  });
  test('lower visual wins, then fewer findings', () => {
    expect(isBetter(rep(10), rep(30))).toBe(true);
    expect(isBetter(rep(30), rep(10))).toBe(false);
    const oneFinding = rep(10, { paths: [{ code: 'missing_route', target: 'a', detail: 'b' }] });
    expect(isBetter(rep(10), oneFinding)).toBe(true); // 0 findings beats 1 at the same visual
  });
});
