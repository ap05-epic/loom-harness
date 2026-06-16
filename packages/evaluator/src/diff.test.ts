import { PNG } from 'pngjs';
import { describe, expect, test } from 'vitest';
import { diffImages } from './diff.js';

/** Build a PNG buffer; paint(x,y) returns [r,g,b,a]. */
function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
): Buffer {
  const p = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      p.data[i] = r;
      p.data[i + 1] = g;
      p.data[i + 2] = b;
      p.data[i + 3] = a;
    }
  }
  return PNG.sync.write(p);
}

const white = (): [number, number, number, number] => [255, 255, 255, 255];

describe('diffImages', () => {
  test('identical images report 0% difference', () => {
    const a = png(10, 10, white);
    const b = png(10, 10, white);
    const r = diffImages(a, b);
    expect(r.diffPixels).toBe(0);
    expect(r.diffPercent).toBe(0);
    expect(r.totalPixels).toBe(100);
  });

  test('a single changed pixel produces a small non-zero difference', () => {
    const a = png(10, 10, white);
    const b = png(10, 10, (x, y) => (x === 5 && y === 5 ? [0, 0, 0, 255] : white()));
    const r = diffImages(a, b);
    expect(r.diffPixels).toBeGreaterThanOrEqual(1);
    expect(r.diffPercent).toBeGreaterThan(0);
    expect(r.diffPercent).toBeLessThan(2);
  });

  test('differences inside a mask rectangle are ignored', () => {
    const a = png(10, 10, white);
    const b = png(10, 10, (x, y) => (x === 5 && y === 5 ? [0, 0, 0, 255] : white()));
    const r = diffImages(a, b, { masks: [{ x: 4, y: 4, width: 3, height: 3 }] });
    expect(r.diffPixels).toBe(0);
    expect(r.diffPercent).toBe(0);
  });

  test('mismatched dimensions throw a clear error', () => {
    expect(() => diffImages(png(10, 10, white), png(12, 10, white))).toThrow(/size mismatch/i);
  });

  test('returns a diff PNG that is a valid image', () => {
    const a = png(8, 8, white);
    const b = png(8, 8, (x) => (x < 4 ? [0, 0, 0, 255] : white()));
    const r = diffImages(a, b);
    const decoded = PNG.sync.read(r.diffPng);
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);
    expect(r.diffPercent).toBeGreaterThan(40); // half the image changed
  });
});
