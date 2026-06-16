import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS, openDb, QuestionStore, runMigrations } from '@loom/core';
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

function seededDb(): { path: string; questionId: string } {
  const path = join(mkdtempSync(join(tmpdir(), 'cli-q-')), 'loom.db');
  const db = openDb(path);
  runMigrations(db, MIGRATIONS);
  const q = new QuestionStore(db).ask({
    wpId: 'wp_1',
    question: 'Which date format should the grid use?',
  });
  db.close();
  return { path, questionId: q.id };
}

describe('loom questions', () => {
  test('list shows the open questions', async () => {
    const { path, questionId } = seededDb();
    const { stdout, stderr, exitCode } = await run(['questions', 'list', '--db', path, '--json']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    const env = JSON.parse(stdout.trim());
    expect(env).toMatchObject({ ok: true, command: 'questions.list' });
    expect((env.data.questions as Array<{ id: string }>).map((q) => q.id)).toContain(questionId);
  });

  test('answer records the answer and closes the question', async () => {
    const { path, questionId } = seededDb();
    const { exitCode } = await run([
      'questions',
      'answer',
      questionId,
      '--answer',
      'use dd.MM.yyyy',
      '--db',
      path,
      '--json',
    ]);
    expect(exitCode).toBe(0);
    const db = openDb(path);
    const q = new QuestionStore(db).get(questionId)!;
    expect(q.status).toBe('answered');
    expect(q.answer).toBe('use dd.MM.yyyy');
    db.close();
  });

  test('answer without --answer is a USAGE error (exit 2)', async () => {
    const { path, questionId } = seededDb();
    const { stdout, exitCode } = await run([
      'questions',
      'answer',
      questionId,
      '--db',
      path,
      '--json',
    ]);
    expect(exitCode).toBe(2);
    expect(JSON.parse(stdout.trim()).error.code).toBe('USAGE');
  });

  test('answering an unknown question is NOT_FOUND (exit 9)', async () => {
    const { path } = seededDb();
    const { stdout, exitCode } = await run([
      'questions',
      'answer',
      'q_nope',
      '--answer',
      'x',
      '--db',
      path,
      '--json',
    ]);
    expect(exitCode).toBe(9);
    expect(JSON.parse(stdout.trim()).error.code).toBe('NOT_FOUND');
  });
});
