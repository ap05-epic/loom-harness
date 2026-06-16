import type { DomSnapshot } from '@loom/browser';
import { describe, expect, test } from 'vitest';
import { domSignature, screenKey } from './state-identity.js';

const node = (tag: string, extra: Partial<DomSnapshot> = {}): DomSnapshot => ({
  tag,
  attrs: {},
  children: [],
  ...extra,
});

const loginDom = node('body', {
  children: [
    node('form', {
      attrs: { action: '/login' },
      children: [
        node('input', { attrs: { name: 'username', type: 'text' } }),
        node('input', { attrs: { name: 'password', type: 'password' } }),
      ],
    }),
  ],
});

const listWith = (rows: number): DomSnapshot =>
  node('body', {
    children: [
      node('table', {
        children: Array.from({ length: rows }, (_, i) =>
          node('tr', { children: [node('td', { text: `deal ${i}` })] }),
        ),
      }),
    ],
  });

describe('domSignature', () => {
  test('collapses repeated sibling rows so data volume does not change identity', () => {
    expect(domSignature(listWith(3))).toBe(domSignature(listWith(50)));
  });

  test('distinguishes structurally different screens', () => {
    expect(domSignature(loginDom)).not.toBe(domSignature(listWith(3)));
  });

  test('keys on structural attributes (name/type/role), not text', () => {
    const a = node('input', { attrs: { name: 'u', type: 'text' }, text: 'hello' });
    const b = node('input', { attrs: { name: 'u', type: 'text' }, text: 'world' });
    expect(domSignature(a)).toBe(domSignature(b));
  });
});

describe('screenKey', () => {
  test('same url + structure → same key', () => {
    expect(screenKey({ url: 'http://x/list', dom: listWith(3) })).toBe(
      screenKey({ url: 'http://x/list', dom: listWith(9) }),
    );
  });

  test('different structure at the same url → different keys', () => {
    expect(screenKey({ url: 'http://x/p', dom: loginDom })).not.toBe(
      screenKey({ url: 'http://x/p', dom: listWith(3) }),
    );
  });

  test('normalizes the origin so local and prod map together', () => {
    expect(screenKey({ url: 'http://localhost:8090/list', dom: loginDom })).toBe(
      screenKey({ url: 'https://prod.example.com/list', dom: loginDom }),
    );
  });

  test('the frame path is part of identity', () => {
    expect(screenKey({ url: 'http://x/p', dom: loginDom })).not.toBe(
      screenKey({ url: 'http://x/p', framePath: 'popup', dom: loginDom }),
    );
  });

  test('keys are short, stable, hex strings', () => {
    const k = screenKey({ url: 'http://x/list', dom: listWith(3) });
    expect(k).toMatch(/^[0-9a-f]{16}$/);
  });
});
