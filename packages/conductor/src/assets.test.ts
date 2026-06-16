import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { scanAssets } from './assets.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'assets-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('scanAssets', () => {
  test('hashes every file under a dir with its relative path + kind', () => {
    writeFileSync(join(dir, 'app.css'), 'body{}');
    mkdirSync(join(dir, 'js'));
    writeFileSync(join(dir, 'js', 'main.js'), 'console.log(1)');

    const digests = scanAssets(dir);
    const byPath = Object.fromEntries(digests.map((d) => [d.path.replace(/\\/g, '/'), d]));
    expect(byPath['app.css']).toMatchObject({ sha256: sha('body{}'), kind: 'css' });
    expect(byPath['js/main.js']).toMatchObject({ sha256: sha('console.log(1)'), kind: 'js' });
  });

  test('an empty dir yields no digests', () => {
    expect(scanAssets(dir)).toEqual([]);
  });
});
