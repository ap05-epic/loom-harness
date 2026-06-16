import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MIGRATIONS, openDb, runMigrations } from '@loom/core';
import { HarnessError } from '../../errors.js';
import { defineCommand } from '../../registry.js';
import { resolveTargetTag } from '../../update.js';

function findRepoRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new HarnessError({
        code: 'CONFIG',
        exitCode: 3,
        message: 'not inside a Loom checkout (pnpm-workspace.yaml not found)',
      });
    }
    current = parent;
  }
}

function sh(command: string, args: string[], cwd: string): void {
  const res = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    throw new HarnessError({
      code: 'RUNTIME',
      message: `${command} ${args.join(' ')} failed (exit ${res.status})`,
    });
  }
}

function shOut(command: string, args: string[], cwd: string): string {
  const res = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    throw new HarnessError({ code: 'RUNTIME', message: res.stderr || `${command} failed` });
  }
  return res.stdout;
}

export const updateCommand = defineCommand({
  name: 'update',
  group: 'lifecycle',
  describe:
    'Update this checkout to the latest (or given) release tag, reinstall, rebuild, migrate',
  exitCodes: ['CONFIG', 'NETWORK'],
  options: [
    { flags: '--to <tag>', describe: 'specific release tag (vX.Y.Z)' },
    { flags: '--db <path>', describe: 'loom.db to back up and migrate after the update' },
    { flags: '--check', describe: 'show the target tag without applying' },
  ],
  examples: ['loom update', 'loom update --to v1.2.0 --db ./.loom-data/loom.db'],
  run(ctx, input) {
    const root = findRepoRoot(ctx.cwd);
    sh('git', ['fetch', '--tags', '--quiet'], root);
    const tags = shOut('git', ['tag', '--list'], root)
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    const target = resolveTargetTag(tags, input.options.to as string | undefined);

    if (input.options.check) return { target, applied: [], checkedOnly: true };

    ctx.sink.info(`updating to ${target}…`);
    sh('git', ['checkout', '--quiet', target], root);
    sh('pnpm', ['install', '--frozen-lockfile'], root);
    sh('pnpm', ['build'], root);

    let applied: number[] = [];
    const dbPath = input.options.db as string | undefined;
    if (dbPath && existsSync(dbPath)) {
      copyFileSync(dbPath, `${dbPath}.bak-${target}`);
      const db = openDb(dbPath);
      applied = runMigrations(db, MIGRATIONS);
      db.close();
    }
    return { target, applied, checkedOnly: false };
  },
  render(data, ctx) {
    const d = data as { target: string; applied: number[]; checkedOnly: boolean };
    if (d.checkedOnly) {
      ctx.sink.line(`latest tag: ${d.target}`);
      return;
    }
    if (d.applied.length) ctx.sink.line(`Applied migrations: ${d.applied.join(', ')}`);
    ctx.sink.line(`Done. Now at ${d.target}.`);
  },
});
