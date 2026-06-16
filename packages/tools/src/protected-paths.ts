import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Hook } from './hooks.js';

/**
 * A built-in **PreToolUse hook** that enforces protected paths: any tool call
 * whose input carries a `path` escaping `rootDir` (via `..` or an absolute path
 * elsewhere) is vetoed. This is the tool-layer half of "agents write only inside
 * the b-repo" — policy as a composable hook, not baked into each tool.
 */
export function protectedPathsHook(rootDir: string): Hook {
  const root = resolve(rootDir);
  return (payload) => {
    const path = (payload as { input?: { path?: unknown } }).input?.path;
    if (typeof path !== 'string') return; // no path → nothing to protect
    const rel = relative(root, resolve(root, path));
    const escapes = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (escapes) {
      return { block: true, reason: `path "${path}" resolves outside the protected root ${root}` };
    }
    return;
  };
}
