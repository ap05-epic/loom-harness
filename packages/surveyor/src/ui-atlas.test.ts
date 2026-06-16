import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DomSnapshot } from '@loom/browser';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { UiState } from './crawl.js';
import { openUiAtlas, type UiAtlasStore } from './ui-atlas.js';

let dir: string;
let atlas: UiAtlasStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uiatlas-'));
  atlas = openUiAtlas(join(dir, 'uiatlas.db'));
});
afterEach(() => {
  atlas.close();
  rmSync(dir, { recursive: true, force: true });
});

const loginDom: DomSnapshot = {
  tag: 'body',
  attrs: {},
  children: [
    {
      tag: 'form',
      attrs: { action: '/login', method: 'post' },
      children: [
        { tag: 'input', attrs: { name: 'user', type: 'text', maxlength: '20' }, children: [] },
      ],
    },
  ],
};
const loginState: UiState = {
  key: 's1',
  url: 'http://app/login',
  dom: loginDom,
  links: ['http://app/next'],
};
const plainState: UiState = {
  key: 's2',
  url: 'http://app/next',
  dom: { tag: 'body', attrs: {}, children: [] },
  links: [],
};

describe('UiAtlas', () => {
  test('ingests crawled states with their forms and nav edges', () => {
    atlas.ingest([loginState, plainState]);

    expect(
      atlas
        .states()
        .map((s) => s.key)
        .sort(),
    ).toEqual(['s1', 's2']);
    const forms = atlas.formsFor('s1');
    expect(forms).toHaveLength(1);
    expect(forms[0]!.action).toBe('/login');
    expect(forms[0]!.fields[0]).toMatchObject({ name: 'user', maxLength: 20 });
    expect(atlas.navEdges()).toContainEqual({ from: 's1', to: 'http://app/next' });
  });

  test('re-ingesting the same crawl is idempotent (no duplicates)', () => {
    atlas.ingest([loginState]);
    atlas.ingest([loginState]);
    expect(atlas.states()).toHaveLength(1);
    expect(atlas.formsFor('s1')).toHaveLength(1);
    expect(atlas.navEdges()).toHaveLength(1);
  });
});
