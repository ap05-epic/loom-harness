import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, GateStore, MIGRATIONS, openDb, runMigrations, TaskStore } from '@loom/core';
import { describe, expect, test } from 'vitest';
import { registerAll } from '../index.js';
import { buildProgram } from '../../program.js';

type RunResult = { stdout: string; stderr: string; exitCode: number };
async function run(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;
  const program = buildProgram(registerAll(), {
    version: '9.9.9',
    env,
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

/** A loom.db seeded with one run (a passed + a building screen), a gate, and a heartbeat. */
function seededDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-watch-'));
  const path = join(dir, 'loom.db');
  const db = openDb(path);
  runMigrations(db, MIGRATIONS);
  const tasks = new TaskStore(db);
  const run = tasks.createRun({ project: 'fixture' });
  tasks.setRunStage(run.id, 'build');
  const passed = tasks.createWorkPackage({
    runId: run.id,
    title: 'login',
    screenKey: 'login',
    spec: {},
  });
  tasks.setWorkPackageState(passed.id, 'passed');
  const building = tasks.createWorkPackage({
    runId: run.id,
    title: 'list',
    screenKey: 'list',
    spec: {},
  });
  tasks.setWorkPackageState(building.id, 'building');
  new GateStore(db).open({ scopeType: 'wp', scopeId: passed.id, type: 'ship', payload: {} });
  new EventLog(db).append({ type: 'heartbeat', runId: run.id, payload: {} });
  new EventLog(db).append({ type: 'wp.passed', runId: run.id, wpId: passed.id, payload: {} });
  db.close();
  return path;
}

describe('loom watch', () => {
  test('summarizes the active run: stage, screen tally, inbox, recent events', async () => {
    const db = seededDb();
    const { stdout, exitCode } = await run(['watch', '--db', db, '--json']);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout.trim()).data;
    expect(data.run.stage).toBe('build');
    expect(data.project).toBe('fixture');
    expect(data.screens).toHaveLength(2);
    expect(data.gatesOpen).toBe(1);
    expect(data.heartbeatAgeMs).not.toBeNull();
    expect(data.recent.map((e: { type: string }) => e.type)).toContain('wp.passed');
  });

  test('renders a human dashboard frame', async () => {
    const db = seededDb();
    const { stdout, exitCode } = await run(['watch', '--db', db]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('loom 9.9.9');
    expect(stdout).toMatch(/1[^\n]*passed/);
    expect(stdout).toMatch(/1[^\n]*building/);
    expect(stdout).toMatch(/gate/i);
  });

  test('reports no active run against an empty db', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-watch-empty-'));
    const path = join(dir, 'loom.db');
    const db = openDb(path);
    runMigrations(db, MIGRATIONS);
    db.close();
    const { stdout, exitCode } = await run(['watch', '--db', path]);
    expect(exitCode).toBe(0);
    expect(stdout.toLowerCase()).toContain('no active run');
  });
});
