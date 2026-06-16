import { describe, expect, test } from 'vitest';
import { deepMap, type AreaMap, type MapTarget } from './deep-map.js';

const targets: MapTarget[] = [
  { id: 'qnr', kind: 'screen' },
  { id: 'schedule-c', kind: 'screen' },
  { id: 'pricing', kind: 'screen' },
];

const fakeMapper =
  (entities: Record<string, string[]>, links: Record<string, AreaMap['links']>) =>
  async (t: MapTarget): Promise<AreaMap> => ({
    id: t.id,
    summary: `mapped ${t.id}`,
    entities: entities[t.id] ?? [],
    links: links[t.id] ?? [],
  });

describe('deepMap', () => {
  test('fans sub-agents over the targets and aggregates a deduped map', async () => {
    const mapTarget = fakeMapper(
      {
        qnr: ['QnrService', 'Account'],
        'schedule-c': ['Account', 'AdjustmentDao'],
        pricing: ['Pricing'],
      },
      { qnr: [{ to: 'schedule-c', via: 'menu' }], 'schedule-c': [{ to: 'pricing' }] },
    );
    const seen: string[] = [];
    const result = await deepMap({ targets, mapTarget, onArea: (a) => seen.push(a.id) });

    expect(result.mapped).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.areas.map((a) => a.id)).toEqual(['qnr', 'schedule-c', 'pricing']); // input order
    // entities are the deduped union (Account appears in two areas → once)
    expect([...result.entities].sort()).toEqual([
      'Account',
      'AdjustmentDao',
      'Pricing',
      'QnrService',
    ]);
    expect(result.connections).toContainEqual({ from: 'qnr', to: 'schedule-c', via: 'menu' });
    expect(seen).toEqual(['qnr', 'schedule-c', 'pricing']); // onArea per completed area
  });

  test('a target budget caps the swarm on a huge app', async () => {
    const result = await deepMap({ targets, mapTarget: fakeMapper({}, {}), maxTargets: 2 });
    expect(result.mapped).toBe(2);
    expect(result.truncated).toBe(true);
  });

  test('never exceeds the concurrency limit (bounded fan-out)', async () => {
    let inFlight = 0;
    let peak = 0;
    const mapTarget = async (t: MapTarget): Promise<AreaMap> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { id: t.id, summary: '', entities: [], links: [] };
    };
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}` }));
    await deepMap({ targets: many, mapTarget, concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });
});
