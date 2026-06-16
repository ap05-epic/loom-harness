import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { assetDigest, classifyAsset, findCopiedAssets } from './anticheat.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

describe('classifyAsset', () => {
  test('classifies by extension', () => {
    expect(classifyAsset('a/app.css')).toBe('css');
    expect(classifyAsset('a/app.min.JS')).toBe('js');
    expect(classifyAsset('a/logo.png')).toBe('image');
    expect(classifyAsset('a/icon.svg')).toBe('image');
    expect(classifyAsset('a/page.html')).toBe('html');
    expect(classifyAsset('a/data.bin')).toBe('other');
  });
});

describe('assetDigest', () => {
  test('hashes content and classifies the path', () => {
    expect(assetDigest('styles.css', 'body{}')).toEqual({
      path: 'styles.css',
      sha256: sha('body{}'),
      kind: 'css',
    });
  });
});

describe('findCopiedAssets', () => {
  test('flags rebuild assets byte-identical to a legacy asset (the cheat)', () => {
    const legacy = [
      { path: 'legacy/app.css', sha256: sha('CSS'), kind: 'css' as const },
      { path: 'legacy/logo.png', sha256: sha('PNG'), kind: 'image' as const },
    ];
    const rebuild = [
      { path: 'b/app.css', sha256: sha('CSS'), kind: 'css' as const }, // copied verbatim
      { path: 'b/new.css', sha256: sha('REWRITTEN'), kind: 'css' as const }, // reimplemented — fine
      { path: 'b/logo.png', sha256: sha('PNG'), kind: 'image' as const }, // copied
    ];

    const copied = findCopiedAssets(legacy, rebuild);
    expect(copied).toHaveLength(2);
    expect(copied).toContainEqual({
      rebuildPath: 'b/app.css',
      legacyPath: 'legacy/app.css',
      sha256: sha('CSS'),
      kind: 'css',
    });
    expect(copied.map((c) => c.rebuildPath)).toContain('b/logo.png');
    expect(copied.map((c) => c.rebuildPath)).not.toContain('b/new.css');
  });

  test('a fully reimplemented rebuild has no copied assets', () => {
    const legacy = [{ path: 'legacy/app.css', sha256: sha('A'), kind: 'css' as const }];
    const rebuild = [{ path: 'b/app.css', sha256: sha('B'), kind: 'css' as const }];
    expect(findCopiedAssets(legacy, rebuild)).toEqual([]);
  });
});
