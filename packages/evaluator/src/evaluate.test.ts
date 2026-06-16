import { PNG } from 'pngjs';
import { describe, expect, test } from 'vitest';
import { evaluateVisual } from './evaluate.js';

function solid(w: number, h: number, rgb: [number, number, number]): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    p.data[i * 4] = rgb[0];
    p.data[i * 4 + 1] = rgb[1];
    p.data[i * 4 + 2] = rgb[2];
    p.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(p);
}

const white = solid(20, 20, [255, 255, 255]);
const black = solid(20, 20, [0, 0, 0]);

describe('evaluateVisual', () => {
  test('identical pairs pass and report 0% with a diff image each', () => {
    const r = evaluateVisual(
      [
        { state: 'login', viewport: 'desktop', a: white, b: white },
        { state: 'list', viewport: 'desktop', a: black, b: black },
      ],
      { threshold: 1 },
    );
    expect(r.verdict.passed).toBe(true);
    expect(r.pairs).toHaveLength(2);
    expect(r.pairs.every((p) => p.diffPercent === 0)).toBe(true);
    expect(r.pairs[0]!.diffPng.length).toBeGreaterThan(0);
  });

  test('a differing pair fails and names the state', () => {
    const r = evaluateVisual(
      [
        { state: 'login', viewport: 'desktop', a: white, b: white },
        { state: 'list', viewport: 'desktop', a: white, b: black },
      ],
      { threshold: 1 },
    );
    expect(r.verdict.passed).toBe(false);
    expect(r.verdict.failures.map((f) => f.state)).toEqual(['list']);
    expect(r.verdict.worst.state).toBe('list');
  });

  test('per-pair masks are honored', () => {
    const r = evaluateVisual(
      [
        {
          state: 'x',
          viewport: 'desktop',
          a: white,
          b: black,
          masks: [{ x: 0, y: 0, width: 20, height: 20 }],
        },
      ],
      { threshold: 1 },
    );
    expect(r.verdict.passed).toBe(true);
  });
});
