import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS, openDb, runMigrations } from '@harness/core';
import { usageError } from '../../errors.js';
import { defineCommand } from '../../registry.js';

function resolveDbPath(ctx: { flags: { dataDir?: string } }, optionDb: unknown): string {
  if (typeof optionDb === 'string' && optionDb) return optionDb;
  if (ctx.flags.dataDir) return join(ctx.flags.dataDir, 'harness.db');
  throw usageError('no database path', 'pass --db <path> or set --data-dir');
}

export const dbMigrateCommand = defineCommand({
  name: 'db migrate',
  group: 'lifecycle',
  describe: 'Apply pending harness.db migrations',
  options: [{ flags: '--db <path>', describe: 'path to harness.db (created if missing)' }],
  examples: ['harness db migrate --db ./.harness-data/harness.db'],
  run(ctx, input) {
    const path = resolveDbPath(ctx, input.options.db);
    const db = openDb(path);
    const applied = runMigrations(db, MIGRATIONS);
    db.close();
    return { db: path, applied };
  },
  render(data, ctx) {
    const d = data as { db: string; applied: number[] };
    ctx.sink.line(
      d.applied.length ? `Applied migrations: ${d.applied.join(', ')}` : 'Already up to date.',
    );
  },
});

export const dbBackupCommand = defineCommand({
  name: 'db backup',
  group: 'lifecycle',
  describe: 'Copy harness.db to a timestamped backup',
  options: [
    { flags: '--db <path>', describe: 'path to harness.db' },
    { flags: '--label <label>', describe: 'backup label (default: timestamp)' },
  ],
  run(ctx, input) {
    const path = resolveDbPath(ctx, input.options.db);
    if (!existsSync(path)) throw usageError(`database not found: ${path}`);
    const label =
      typeof input.options.label === 'string' && input.options.label
        ? input.options.label
        : new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${path}.bak-${label}`;
    copyFileSync(path, backup);
    return { db: path, backup };
  },
  render(data, ctx) {
    const d = data as { backup: string };
    ctx.sink.line(`Backed up to ${d.backup}`);
  },
});
