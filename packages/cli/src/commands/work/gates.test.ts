import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { GateStore, MIGRATIONS, openDb, runMigrations, SkillStore, TaskStore } from '@loom/core';
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

/** A loom.db with one draft skill and an open skill gate pointing at it. */
function seededDb(): { path: string; skillId: string; gateId: string } {
  const path = join(mkdtempSync(join(tmpdir(), 'cli-gates-')), 'loom.db');
  const db = openDb(path);
  runMigrations(db, MIGRATIONS);
  const skill = new SkillStore(db).addSkill({
    project: 'demo',
    name: 'login-form-parity',
    description: 'reproduce the login form',
    triggers: ['login'],
    body: 'keep type=password',
    tier: 'generated',
    status: 'draft',
  });
  const gate = new GateStore(db).open({
    scopeType: 'skill',
    scopeId: skill.id,
    type: 'skill',
    payload: { name: skill.name },
  });
  db.close();
  return { path, skillId: skill.id, gateId: gate.id };
}

describe('loom gates', () => {
  test('list shows the open gates', async () => {
    const { path, gateId } = seededDb();
    const { stdout, stderr, exitCode } = await run(['gates', 'list', '--db', path, '--json']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    const env = JSON.parse(stdout.trim());
    expect(env).toMatchObject({ ok: true, command: 'gates.list' });
    expect((env.data.gates as Array<{ id: string }>).map((g) => g.id)).toContain(gateId);
  });

  test('approving a skill gate activates the skill', async () => {
    const { path, skillId, gateId } = seededDb();
    const { stdout, exitCode } = await run(['gates', 'approve', gateId, '--db', path, '--json']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim()).data).toMatchObject({ status: 'approved', activated: true });

    const db = openDb(path);
    expect(new SkillStore(db).get(skillId)!.status).toBe('active');
    db.close();
  });

  test('approving a ship gate marks the work package shipped', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cli-gates-')), 'loom.db');
    const db = openDb(path);
    runMigrations(db, MIGRATIONS);
    const store = new TaskStore(db);
    const taskRun = store.createRun({ project: 'demo' });
    const wp = store.createWorkPackage({ runId: taskRun.id, screenKey: 'login', title: 'Login' });
    store.setWorkPackageState(wp.id, 'passed');
    const gate = new GateStore(db).open({
      scopeType: 'wp',
      scopeId: wp.id,
      type: 'ship',
      payload: { screenKey: 'login' },
    });
    db.close();

    const { exitCode } = await run(['gates', 'approve', gate.id, '--db', path, '--json']);
    expect(exitCode).toBe(0);
    const db2 = openDb(path);
    expect(new TaskStore(db2).getWorkPackage(wp.id)!.state).toBe('shipped');
    db2.close();
  });

  test('rejecting a skill gate archives the skill', async () => {
    const { path, skillId, gateId } = seededDb();
    const { exitCode } = await run([
      'gates',
      'reject',
      gateId,
      '--db',
      path,
      '--note',
      'nope',
      '--json',
    ]);
    expect(exitCode).toBe(0);
    const db = openDb(path);
    expect(new SkillStore(db).get(skillId)!.status).toBe('archived');
    db.close();
  });

  test('approving an unknown gate is NOT_FOUND (exit 9)', async () => {
    const { path } = seededDb();
    const { stdout, exitCode } = await run([
      'gates',
      'approve',
      'gate_nope',
      '--db',
      path,
      '--json',
    ]);
    expect(exitCode).toBe(9);
    expect(JSON.parse(stdout.trim()).error.code).toBe('NOT_FOUND');
  });
});
