import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export type Rect = { x: number; y: number; width: number; height: number };

export type DiffOptions = {
  /** pixelmatch per-pixel sensitivity (0 strict … 1 loose); default 0.1. */
  threshold?: number;
  /** Rectangles to ignore (dynamic regions: timestamps, ids, etc.). */
  masks?: Rect[];
};

export type DiffResult = {
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  diffPercent: number;
  /** PNG highlighting the differing pixels. */
  diffPng: Buffer;
};

/** Force the masked rectangle in `b` to equal `a` so it never counts as a diff. */
function applyMask(a: PNG, b: PNG, rect: Rect): void {
  const x1 = Math.max(0, rect.x);
  const y1 = Math.max(0, rect.y);
  const x2 = Math.min(a.width, rect.x + rect.width);
  const y2 = Math.min(a.height, rect.y + rect.height);
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const i = (y * a.width + x) * 4;
      b.data[i] = a.data[i]!;
      b.data[i + 1] = a.data[i + 1]!;
      b.data[i + 2] = a.data[i + 2]!;
      b.data[i + 3] = a.data[i + 3]!;
    }
  }
}

/**
 * Deterministic pixel diff of two PNGs with optional masked regions. The judge's
 * visual layer — pure, no browser, so it can be mutation-tested in CI.
 */
export function diffImages(a: Buffer, b: Buffer, options: DiffOptions = {}): DiffResult {
  const ia = PNG.sync.read(a);
  const ib = PNG.sync.read(b);
  if (ia.width !== ib.width || ia.height !== ib.height) {
    throw new Error(`image size mismatch: ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`);
  }
  for (const mask of options.masks ?? []) applyMask(ia, ib, mask);

  const { width, height } = ia;
  const out = new PNG({ width, height });
  const diffPixels = pixelmatch(ia.data, ib.data, out.data, width, height, {
    threshold: options.threshold ?? 0.1,
  });
  const totalPixels = width * height;
  return {
    width,
    height,
    diffPixels,
    totalPixels,
    diffPercent: (diffPixels / totalPixels) * 100,
    diffPng: PNG.sync.write(out),
  };
}
