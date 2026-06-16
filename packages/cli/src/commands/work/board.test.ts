import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, MIGRATIONS, openDb, runMigrations, TaskStore } from '@loom/core';
import { describe, expect, test } from 'vitest';
import { registerAll } from '../index.js';
import { buildProgram } from '../../program.js';

function seedDb(): { dbPath: string; runId: string; wpId: string } {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cli-board-')), 'loom.db');
  const db = openDb(dbPath);
  runMigrations(db, MIGRATIONS);
  const store = new TaskStore(db);
  const events = new EventLog(db);
  const run = store.createRun({ project: 'fixture' });
  const wp = store.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Rebuild login' });
  const a1 = store.createAttempt({ wpId: wp.id, role: 'builder', model: 'gpt-5.4' });
  store.recordEval({ wpId: wp.id, attemptId: a1.id, visualPct: 0.4, passed: true, scorecard: {} });
  store.finishAttempt(a1.id, { status: 'passed', inputTokens: 100, outputTokens: 50 });
  store.setWorkPackageState(wp.id, 'passed');
  events.append({ type: 'wp.passed', runId: run.id, wpId: wp.id, payload: { diffPercent: 0.4 } });
  db.close();
  return { dbPath, runId: run.id, wpId: wp.id };
}

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

describe('read-only board over loom.db (wp list / wp show / logs)', () => {
  test('wp list shows the work packages of the latest run', async () => {
    const { dbPath, wpId } = seedDb();
    const { stdout, exitCode } = await run(['wp', 'list', '--db', dbPath, '--json']);
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout.trim());
    expect(env.ok).toBe(true);
    const wps = env.data.workPackages as Array<Record<string, unknown>>;
    expect(wps).toHaveLength(1);
    expect(wps[0]).toMatchObject({ id: wpId, screenKey: 'login', state: 'passed', attempts: 1 });
    expect(wps[0].bestDiff).toBe(0.4);
  });

  test('wp show details one work package and its attempts', async () => {
    const { dbPath, wpId } = seedDb();
    const { stdout } = await run(['wp', 'show', wpId, '--db', dbPath, '--json']);
    const env = JSON.parse(stdout.trim());
    expect(env.data).toMatchObject({ id: wpId, screenKey: 'login', state: 'passed' });
    expect(env.data.attempts).toHaveLength(1);
    expect(env.data.attempts[0]).toMatchObject({
      role: 'builder',
      status: 'passed',
      outputTokens: 50,
    });
    expect(env.data.bestEval).toMatchObject({ passed: true, visualPct: 0.4 });
  });

  test('wp show on an unknown id is NOT_FOUND (exit 9)', async () => {
    const { dbPath } = seedDb();
    const { stdout, exitCode } = await run(['wp', 'show', 'wp_nope', '--db', dbPath, '--json']);
    expect(exitCode).toBe(9);
    expect(JSON.parse(stdout.trim()).error.code).toBe('NOT_FOUND');
  });

  test('logs tails events for the latest run', async () => {
    const { dbPath } = seedDb();
    const { stdout } = await run(['logs', '--db', dbPath, '--json']);
    const env = JSON.parse(stdout.trim());
    const types = (env.data.events as Array<{ type: string }>).map((e) => e.type);
    expect(types).toContain('wp.passed');
  });

  test('a read command on a missing db is NOT_FOUND (exit 9)', async () => {
    const { stdout, exitCode } = await run([
      'wp',
      'list',
      '--db',
      join(tmpdir(), 'nope-loom.db'),
      '--json',
    ]);
    expect(exitCode).toBe(9);
    expect(JSON.parse(stdout.trim()).error.code).toBe('NOT_FOUND');
  });
});
