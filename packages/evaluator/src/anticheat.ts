import { createHash } from 'node:crypto';
import { extname } from 'node:path';

/**
 * Anti-cheat (evaluator layer 7): the rebuild must be genuinely **reimplemented**, not assembled
 * from copied legacy assets. This scans the rebuilt bundle for files byte-identical to a legacy
 * source asset — a CSS/JS/image lifted wholesale rather than rewritten. Pure + content-hash based,
 * so it's deterministic and needs no browser. Pair it with the visual/structural gates, which the
 * structural gate already complements by catching screenshot-embed cheats (B would lack real DOM).
 */

export type AssetKind = 'css' | 'js' | 'image' | 'html' | 'other';

/** A file identified by its content hash + kind. */
export type AssetDigest = { path: string; sha256: string; kind: AssetKind };

/** A rebuild asset that is byte-identical to a legacy asset. */
export type CopiedAsset = {
  rebuildPath: string;
  legacyPath: string;
  sha256: string;
  kind: AssetKind;
};

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp']);

/** Classify an asset by file extension. */
export function classifyAsset(path: string): AssetKind {
  const ext = extname(path).toLowerCase();
  if (ext === '.css' || ext === '.less' || ext === '.scss') return 'css';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.ts') return 'js';
  if (ext === '.html' || ext === '.htm' || ext === '.jsp') return 'html';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'other';
}

/** Hash a file's content and classify its path. */
export function assetDigest(path: string, content: Buffer | string): AssetDigest {
  return {
    path,
    sha256: createHash('sha256').update(content).digest('hex'),
    kind: classifyAsset(path),
  };
}

/**
 * Rebuild assets whose content is byte-identical to a legacy asset — copied verbatim instead of
 * reimplemented. Matched by content hash (path-independent), so a renamed copy is still caught.
 */
export function findCopiedAssets(legacy: AssetDigest[], rebuild: AssetDigest[]): CopiedAsset[] {
  const byHash = new Map<string, string>();
  for (const a of legacy) if (!byHash.has(a.sha256)) byHash.set(a.sha256, a.path);

  const copied: CopiedAsset[] = [];
  for (const r of rebuild) {
    const legacyPath = byHash.get(r.sha256);
    if (legacyPath)
      copied.push({ rebuildPath: r.path, legacyPath, sha256: r.sha256, kind: r.kind });
  }
  return copied;
}
