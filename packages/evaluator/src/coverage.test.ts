import { describe, expect, test } from 'vitest';
import { coverageLedger } from './coverage.js';

describe('coverageLedger', () => {
  test('everything planned, crawled, and built → complete at 100%', () => {
    const r = coverageLedger({
      planned: ['login', 'list', 'wizard'],
      crawled: ['login', 'list', 'wizard'],
      built: ['login', 'list', 'wizard'],
    });
    expect(r.complete).toBe(true);
    expect(r.coveragePct).toBe(100);
    expect(r.notBuilt).toEqual([]);
  });

  test('a planned screen the crawler never reached is flagged (crawl gap)', () => {
    const r = coverageLedger({
      planned: ['login', 'list', 'popup'],
      crawled: ['login', 'list'],
      built: ['login', 'list'],
    });
    expect(r.missingFromCrawl).toEqual(['popup']);
    // popup was never crawled, so it isn't built → not complete
    expect(r.complete).toBe(false);
    expect(r.notBuilt).toContain('popup');
  });

  test('a crawled screen not in the static plan is flagged (runtime-only)', () => {
    const r = coverageLedger({
      planned: ['login'],
      crawled: ['login', 'search-overlay'],
      built: ['login'],
    });
    expect(r.unplanned).toEqual(['search-overlay']);
    expect(r.notBuilt).toContain('search-overlay');
  });

  test('discovered-but-unbuilt screens block completion', () => {
    const r = coverageLedger({
      planned: ['login', 'list'],
      crawled: ['login', 'list'],
      built: ['login'],
    });
    expect(r.complete).toBe(false);
    expect(r.notBuilt).toEqual(['list']);
    expect(r.coveragePct).toBe(50);
  });

  test('total is the union of planned and crawled; built counts only discovered screens', () => {
    const r = coverageLedger({
      planned: ['a', 'b'],
      crawled: ['b', 'c'],
      built: ['a', 'b', 'c', 'ghost'], // "ghost" isn't discovered — ignored
    });
    expect(r.total).toBe(3); // a, b, c
    expect(r.built).toBe(3);
    expect(r.complete).toBe(true);
  });

  test('an empty run is vacuously complete at 100%', () => {
    const r = coverageLedger({ planned: [], crawled: [], built: [] });
    expect(r.total).toBe(0);
    expect(r.coveragePct).toBe(100);
    expect(r.complete).toBe(true);
  });
});
