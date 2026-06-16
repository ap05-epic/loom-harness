import type { DomSnapshot, Viewport } from '@loom/browser';
import { PNG } from 'pngjs';
import { describe, expect, test } from 'vitest';
import { evaluateScreen } from './eval-screen.js';

/** A solid-colour PNG so the visual gate has real images to diff. */
function solidPng(rgb: [number, number, number]): Buffer {
  const p = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = rgb[0];
    p.data[i + 1] = rgb[1];
    p.data[i + 2] = rgb[2];
    p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}

const VIEWPORT: Viewport = { width: 1280, height: 1024 };
const png = solidPng([240, 240, 240]);
const fakeServe = async (): Promise<{ url: string; stop: () => Promise<void> }> => ({
  url: 'http://b/',
  stop: async () => undefined,
});

/** A login form whose `user` field optionally carries a maxlength constraint. */
const loginForm = (maxlength?: string): DomSnapshot => ({
  tag: 'body',
  attrs: {},
  children: [
    {
      tag: 'form',
      attrs: {},
      children: [
        {
          tag: 'input',
          attrs: { name: 'user', type: 'text', ...(maxlength ? { maxlength } : {}) },
          children: [],
        },
      ],
    },
  ],
});

const baseArgs = {
  stateKey: 'login',
  bRepoDir: '/b',
  baseline: png,
  legacyUrl: 'http://a/',
  capture: async (): Promise<Buffer> => png, // identical to baseline ⇒ 0% visual
  viewport: VIEWPORT,
  threshold: 1,
  serve: fakeServe,
};

describe('evaluateScreen functional gate', () => {
  test('fails a rebuild that drops a field-validation rule the pixel/DOM gates miss', async () => {
    const result = await evaluateScreen({
      ...baseArgs,
      // legacy enforces maxlength=20; the rebuild dropped it
      domCapture: async ({ url }) => (url.includes('a/') ? loginForm('20') : loginForm()),
    });
    expect(result.passed).toBe(false);
    expect(result.functionalFindings.map((f) => f.code)).toContain('lost-maxlength');
  });

  test('an exact rebuild passes every gate (functional included)', async () => {
    const result = await evaluateScreen({
      ...baseArgs,
      domCapture: async () => loginForm('20'), // A and B identical
    });
    expect(result.passed).toBe(true);
    expect(result.functionalFindings).toEqual([]);
  });
});
