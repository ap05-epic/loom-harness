import { PNG } from 'pngjs';
import { describe, expect, test } from 'vitest';
import { diffImages } from './diff.js';
import { scoreVisual, type StateDiff } from './scorecard.js';

const W = 40;
const H = 30;

/** A deterministic "screen": white with a colored header band. */
function screen(headerColor: [number, number, number], sabotage = false): Buffer {
  const p = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let rgb: [number, number, number] = [255, 255, 255];
      if (y < 6) rgb = headerColor; // header band
      // a sabotaged rebuild paints a large wrong block in the body
      if (sabotage && y >= 10 && y < 25 && x >= 5 && x < 30) rgb = [255, 0, 0];
      p.data[i] = rgb[0];
      p.data[i + 1] = rgb[1];
      p.data[i + 2] = rgb[2];
      p.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(p);
}

/** Diff a set of legacy/rebuilt screen pairs into the scorecard's input shape. */
function diffScreens(pairs: Array<{ state: string; a: Buffer; b: Buffer }>): StateDiff[] {
  return pairs.map(({ state, a, b }) => ({
    state,
    viewport: 'desktop',
    diffPercent: diffImages(a, b).diffPercent,
  }));
}

describe('judge calibration (diff + scorecard end-to-end)', () => {
  const legacyLogin = screen([0, 64, 128]);
  const legacyList = screen([0, 128, 64]);

  test('A-vs-A is a clean pass (~0%)', () => {
    const verdict = scoreVisual(
      diffScreens([
        { state: 'login', a: legacyLogin, b: legacyLogin },
        { state: 'list', a: legacyList, b: legacyList },
      ]),
      { threshold: 1 },
    );
    expect(verdict.passed).toBe(true);
    expect(verdict.worst.diffPercent).toBe(0);
  });

  test('a faithful rebuild (pixel-identical screens) passes', () => {
    const verdict = scoreVisual(
      diffScreens([
        { state: 'login', a: legacyLogin, b: screen([0, 64, 128]) },
        { state: 'list', a: legacyList, b: screen([0, 128, 64]) },
      ]),
      { threshold: 1 },
    );
    expect(verdict.passed).toBe(true);
  });

  test('a sabotaged rebuild fails and names the offending screen', () => {
    const verdict = scoreVisual(
      diffScreens([
        { state: 'login', a: legacyLogin, b: screen([0, 64, 128]) }, // fine
        { state: 'list', a: legacyList, b: screen([0, 128, 64], true) }, // wrong block
      ]),
      { threshold: 1 },
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.map((f) => f.state)).toEqual(['list']);
    expect(verdict.worst.state).toBe('list');
    expect(verdict.worst.diffPercent).toBeGreaterThan(10);
  });

  test('the same sabotage passes once a human approves a per-screen deviation', () => {
    const diffs = diffScreens([{ state: 'list', a: legacyList, b: screen([0, 128, 64], true) }]);
    const approved = scoreVisual(diffs, { threshold: 1, perStateThreshold: { list: 100 } });
    expect(approved.passed).toBe(true);
  });
});
