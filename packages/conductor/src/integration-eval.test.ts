import { PNG } from 'pngjs';
import { describe, expect, test } from 'vitest';
import type { DomSnapshot } from '@loom/browser';
import type { StaticServer } from './serve.js';
import { integrationEval } from './integration-eval.js';

function solidPng(rgb: [number, number, number]): Buffer {
  const p = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < 4 * 4; i++) {
    const o = i * 4;
    p.data[o] = rgb[0];
    p.data[o + 1] = rgb[1];
    p.data[o + 2] = rgb[2];
    p.data[o + 3] = 255;
  }
  return PNG.sync.write(p);
}

const matchingDom: DomSnapshot = { tag: 'body', attrs: {}, children: [] };
const VIEWPORT = { width: 1280, height: 1024 };

/** A fake static server whose URL encodes the served directory, so capture can vary by screen. */
const fakeServe = (dir: string): Promise<StaticServer> =>
  Promise.resolve({ url: `http://b/${dir}/`, port: 0, stop: () => Promise.resolve() });

describe('integrationEval', () => {
  test('flags only the previously-passed screens that no longer reach parity', async () => {
    const baseline = solidPng([240, 240, 240]);
    // screenB's rebuild now renders black (a shared-component change regressed it); others still match.
    const capture = ({ url }: { url: string }) =>
      Promise.resolve(url.includes('screenB') ? solidPng([0, 0, 0]) : baseline);
    const domCapture = () => Promise.resolve(matchingDom);

    const regressions = await integrationEval({
      screens: [
        { screenKey: 'screenA', bRepoDir: 'screenA', baseline, legacyUrl: 'http://legacy/a' },
        { screenKey: 'screenB', bRepoDir: 'screenB', baseline, legacyUrl: 'http://legacy/b' },
      ],
      capture,
      domCapture,
      viewport: VIEWPORT,
      threshold: 1,
      serve: fakeServe,
    });

    expect(regressions.map((r) => r.screenKey)).toEqual(['screenB']);
    expect(regressions[0]!.diffPercent).toBeGreaterThan(1);
  });

  test('reports no regressions when every screen still matches its baseline', async () => {
    const baseline = solidPng([240, 240, 240]);
    const regressions = await integrationEval({
      screens: [{ screenKey: 'a', bRepoDir: 'a', baseline, legacyUrl: 'http://legacy/a' }],
      capture: () => Promise.resolve(baseline),
      domCapture: () => Promise.resolve(matchingDom),
      viewport: VIEWPORT,
      threshold: 1,
      serve: fakeServe,
    });
    expect(regressions).toEqual([]);
  });
});
