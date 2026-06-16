import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { notFoundError, usageError } from './errors.js';
import type { CliContext } from './context.js';

/** Resolve loom.db: explicit --db flag, else <data-dir>/loom.db (legacy harness.db if it's the only one there). */
export function resolveDbPath(ctx: { flags: { dataDir?: string } }, optionDb: unknown): string {
  if (typeof optionDb === 'string' && optionDb) return optionDb;
  if (ctx.flags.dataDir) {
    const loomDb = join(ctx.flags.dataDir, 'loom.db');
    const legacy = join(ctx.flags.dataDir, 'harness.db');
    if (!existsSync(loomDb) && existsSync(legacy)) return legacy;
    return loomDb;
  }
  throw usageError('no database path', 'pass --db <path> or set --data-dir');
}

/** Resolve loom.db and require it to already exist (read commands). */
export function requireExistingDb(ctx: CliContext, optionDb: unknown): string {
  const path = resolveDbPath(ctx, optionDb);
  if (!existsSync(path)) {
    throw notFoundError('database', path, 'run `loom run` first, or check --data-dir/--db');
  }
  return path;
}
