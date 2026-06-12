import { describe, expect, test } from 'vitest';
import { newId } from './ids.js';

describe('newId', () => {
  test('generates unique ids across many calls', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(ids.size).toBe(5000);
  });

  test('ids are URL- and filename-safe', () => {
    for (let i = 0; i < 100; i++) {
      expect(newId()).toMatch(/^[0-9a-z]+$/);
    }
  });

  test('ids sort by creation time (timestamp prefix)', async () => {
    const a = newId();
    await new Promise((r) => setTimeout(r, 5));
    const b = newId();
    expect(a < b).toBe(true);
  });

  test('accepts a prefix for readable entity ids', () => {
    const id = newId('wp');
    expect(id).toMatch(/^wp_[0-9a-z]+$/);
  });
});
