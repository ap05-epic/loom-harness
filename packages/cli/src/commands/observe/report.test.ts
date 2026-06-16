import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS, openDb, runMigrations, TaskStore } from '@loom/core';
import { registerAll } from '../index.js';
import { buildProgram } from '../../program.js';

type RunResult = { stdout: string; stderr: string; exitCode: number };

async function run(args: string[]): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;
  const program = buildProgram(registerAll(), {
    version: '9.9.9',
    env: {},
    cwd: process.cwd(),
    stdoutTTY: false,
    stdinTTY: false,
    write: (s) => stdout.push(s),
    writeErr: (s) => stderr.push(s),
    exit: (c) => {
      exitCode = c;
    },
  });
  await program.parseAsync(['node', 'loom', ...args]);
  return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode };
}

function seededDb(withRun: boolean): string {
  const path = join(mkdtempSync(join(tmpdir(), 'cli-report-')), 'loom.db');
  const db = openDb(path);
  runMigrations(db, MIGRATIONS);
  if (withRun) {
    const store = new TaskStore(db);
    const run = store.createRun({ project: 'fixture' });
    const wp = store.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Login' });
    store.setWorkPackageState(wp.id, 'passed');
  }
  db.close();
  return path;
}

describe('loom report', () => {
  test('renders the modernization report for the latest run', async () => {
    const path = seededDb(true);
    const { stdout, stderr, exitCode } = await run(['report', '--db', path, '--json']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    const env = JSON.parse(stdout.trim());
    expect(env).toMatchObject({ ok: true, command: 'report' });
    expect(env.data.report).toContain('# Modernization report');
    expect(env.data.report).toContain('login');
  });

  test('no run is NOT_FOUND (exit 9)', async () => {
    const path = seededDb(false);
    const { stdout, exitCode } = await run(['report', '--db', path, '--json']);
    expect(exitCode).toBe(9);
    expect(JSON.parse(stdout.trim()).error.code).toBe('NOT_FOUND');
  });
});
