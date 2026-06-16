import { describe, expect, test } from 'vitest';
import { runWithDeps } from './scheduler.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('runWithDeps', () => {
  test('runs a node only after its dependencies are done', async () => {
    const order: string[] = [];
    await runWithDeps(
      [
        { id: 'a', deps: [], item: 'a' },
        { id: 'b', deps: ['a'], item: 'b' },
        { id: 'c', deps: ['b'], item: 'c' },
      ],
      4,
      async (item) => {
        order.push(item);
        return item;
      },
    );
    expect(order).toEqual(['a', 'b', 'c']);
  });

  test('runs independent nodes concurrently (shared components before screens)', async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithDeps(
      [
        { id: 'x', deps: [], item: 0 },
        { id: 'y', deps: [], item: 0 },
        { id: 'z', deps: [], item: 0 },
      ],
      3,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await delay(5);
        inFlight -= 1;
      },
    );
    expect(peak).toBeGreaterThan(1);
  });

  test('returns results keyed by id', async () => {
    const results = await runWithDeps([{ id: 'a', deps: [], item: 2 }], 1, async (n) => n * 5);
    expect(results.get('a')).toMatchObject({ status: 'done', result: 10 });
  });

  test('blocks a node whose dependency failed (and never runs it)', async () => {
    const ran: string[] = [];
    const results = await runWithDeps(
      [
        { id: 'a', deps: [], item: 'a' },
        { id: 'b', deps: ['a'], item: 'b' },
      ],
      2,
      async (item, id) => {
        ran.push(id);
        if (id === 'a') throw new Error('boom');
        return item;
      },
    );
    expect(results.get('a')!.status).toBe('failed');
    expect(results.get('b')!.status).toBe('blocked');
    expect(ran).toEqual(['a']);
  });

  test('rejects an unknown dependency', async () => {
    await expect(
      runWithDeps([{ id: 'a', deps: ['ghost'], item: 0 }], 1, async () => 0),
    ).rejects.toThrow(/unknown dependency: ghost/i);
  });

  test('rejects a dependency cycle', async () => {
    await expect(
      runWithDeps(
        [
          { id: 'a', deps: ['b'], item: 0 },
          { id: 'b', deps: ['a'], item: 0 },
        ],
        1,
        async () => 0,
      ),
    ).rejects.toThrow(/cycle/i);
  });
});
