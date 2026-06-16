import { describe, expect, test } from 'vitest';
import { mapPool } from './pool.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('mapPool', () => {
  test('runs every item and returns results in input order', async () => {
    const results = await mapPool([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(results).toEqual([10, 20, 30, 40]);
  });

  test('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(5);
      inFlight -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  test('a concurrency of 1 runs strictly in order', async () => {
    const started: number[] = [];
    await mapPool([1, 2, 3], 1, async (n) => {
      started.push(n);
      await delay(1);
      return n;
    });
    expect(started).toEqual([1, 2, 3]);
  });

  test('passes the index to the worker fn', async () => {
    const results = await mapPool(['a', 'b', 'c'], 3, async (item, i) => `${i}:${item}`);
    expect(results).toEqual(['0:a', '1:b', '2:c']);
  });

  test('an empty list resolves to an empty array', async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });

  test('a rejecting task rejects the pool', async () => {
    await expect(
      mapPool([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
