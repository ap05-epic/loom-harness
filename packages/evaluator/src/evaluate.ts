import { diffImages, type Rect } from './diff.js';
import { scoreVisual, type VisualVerdict } from './scorecard.js';

export type CapturePair = {
  state: string;
  viewport: string;
  /** Baseline (legacy) PNG. */
  a: Buffer;
  /** Rebuilt PNG. */
  b: Buffer;
  masks?: Rect[];
};

export type PairResult = {
  state: string;
  viewport: string;
  diffPercent: number;
  diffPixels: number;
  diffPng: Buffer;
};

export type VisualEvalOptions = {
  threshold: number;
  perStateThreshold?: Record<string, number>;
};

export type VisualEvalResult = {
  verdict: VisualVerdict;
  pairs: PairResult[];
};

/**
 * Diff and score a set of captured A/B pairs — the visual evaluation a caller
 * runs after capturing screenshots. Pure (no browser); the diff PNGs are
 * returned for the caller to persist as parity evidence.
 */
export function evaluateVisual(pairs: CapturePair[], options: VisualEvalOptions): VisualEvalResult {
  const results: PairResult[] = pairs.map((pair) => {
    const diff = diffImages(pair.a, pair.b, { masks: pair.masks });
    return {
      state: pair.state,
      viewport: pair.viewport,
      diffPercent: diff.diffPercent,
      diffPixels: diff.diffPixels,
      diffPng: diff.diffPng,
    };
  });
  const verdict = scoreVisual(
    results.map((r) => ({ state: r.state, viewport: r.viewport, diffPercent: r.diffPercent })),
    options,
  );
  return { verdict, pairs: results };
}
