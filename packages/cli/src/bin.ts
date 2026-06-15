#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { MIGRATIONS, openDb, runMigrations } from '@harness/core';
import { BUILTIN_CHECKS, runChecks } from './doctor.js';
import { resolveTargetTag } from './update.js';

// When the harness falls back to Node's built-in SQLite, Node emits a one-time
// experimental notice. Silence only that line so CLI output stays clean; every
// other warning passes through.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning?.message;
  if (typeof message === 'string' && message.includes('SQLite is an experimental feature')) return;
  return (originalEmitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

function findRepoRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current)
      throw new Error('Not inside a harness checkout (pnpm-workspace.yaml not found)');
    current = parent;
  }
}

function sh(command: string, args: string[], cwd: string): void {
  const res = spawnSync(command, args, { cwd, stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${res.status}`);
  }
}

function shCapture(command: string, args: string[], cwd: string): string {
  const res = spawnSync(command, args, { cwd, encoding: 'utf8', shell: true });
  if (res.status !== 0) throw new Error(res.stderr || `${command} failed`);
  return res.stdout;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const version = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(moduleDir, '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
})();

const program = new Command('harness')
  .description('Modernization Harness — agentic legacy-UI modernization')
  .version(version);

program
  .command('doctor')
  .description('Check this environment can run the harness')
  .action(async () => {
    const results = await runChecks(BUILTIN_CHECKS);
    let failed = 0;
    for (const r of results) {
      const mark = r.ok ? 'OK  ' : 'FAIL';
      console.log(`[${mark}] ${r.name}: ${r.detail}`);
      if (!r.ok) {
        failed++;
        if (r.hint) console.log(`       hint: ${r.hint}`);
      }
    }
    console.log('');
    console.log(`${results.length - failed}/${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  });

program
  .command('status')
  .description('Show harness version and checkout state')
  .action(() => {
    const root = findRepoRoot(process.cwd());
    console.log(`harness ${version}`);
    try {
      console.log(`checkout: ${shCapture('git', ['describe', '--tags', '--always'], root).trim()}`);
    } catch {
      console.log('checkout: (not a git checkout)');
    }
    console.log(`node: ${process.versions.node}`);
  });

program
  .command('update')
  .description(
    'Update this checkout to the latest (or given) release tag, reinstall, rebuild, migrate',
  )
  .option('--to <tag>', 'specific release tag (vX.Y.Z)')
  .option('--db <path>', 'harness.db to back up and migrate after the update')
  .action((opts: { to?: string; db?: string }) => {
    const root = findRepoRoot(process.cwd());
    sh('git', ['fetch', '--tags', '--quiet'], root);
    const tags = shCapture('git', ['tag', '--list'], root)
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    const target = resolveTargetTag(tags, opts.to);
    console.log(`Updating to ${target}…`);
    sh('git', ['checkout', '--quiet', target], root);
    sh('pnpm', ['install', '--frozen-lockfile'], root);
    sh('pnpm', ['build'], root);
    if (opts.db && existsSync(opts.db)) {
      const backup = `${opts.db}.bak-${target}`;
      copyFileSync(opts.db, backup);
      const db = openDb(opts.db);
      const applied = runMigrations(db, MIGRATIONS);
      db.close();
      console.log(
        applied.length
          ? `Applied migrations: ${applied.join(', ')} (backup at ${backup})`
          : `Database already up to date (backup at ${backup})`,
      );
    }
    console.log(`Done. Now at ${target}.`);
  });

program
  .command('db-migrate')
  .description('Apply pending harness.db migrations')
  .requiredOption('--db <path>', 'path to harness.db (created if missing)')
  .action((opts: { db: string }) => {
    const db = openDb(opts.db);
    const applied = runMigrations(db, MIGRATIONS);
    db.close();
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
