import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assetDigest, type AssetDigest } from '@loom/evaluator';

/**
 * Hash every file under a directory into content digests — the rebuild's asset inventory for the
 * anti-cheat gate. Paths are recorded relative to `dir`; matched against the legacy source digests
 * by content hash, so a copied-then-renamed asset is still caught.
 */
export function scanAssets(dir: string): AssetDigest[] {
  const out: AssetDigest[] = [];
  const walk = (cur: string): void => {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(assetDigest(relative(dir, full), readFileSync(full)));
    }
  };
  walk(dir);
  return out;
}
