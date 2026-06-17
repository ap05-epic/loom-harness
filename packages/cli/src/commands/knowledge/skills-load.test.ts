import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { openDb, SkillStore } from '@loom/core';
import { registerAll } from '../index.js';
import { buildProgram } from '../../program.js';

// The bundled conversion pack at the repo root.
const CONVERSION_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'skills',
  'conversion',
);

async function run(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const stdout: string[] = [];
  let exitCode = 0;
  const program = buildProgram(registerAll(), {
    version: '9.9.9',
    env: {},
    cwd: process.cwd(),
    stdoutTTY: false,
    stdinTTY: false,
    write: (s) => stdout.push(s),
    writeErr: () => {},
    exit: (c) => {
      exitCode = c;
    },
  });
  await program.parseAsync(['node', 'loom', ...args]);
  return { stdout: stdout.join(''), exitCode };
}

describe('loom skills load', () => {
  test('registers a SKILL.md dir into the store as active bundled skills', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills-load-'));
    const dbPath = join(dir, 'loom.db');
    const { stdout, exitCode } = await run([
      'skills',
      'load',
      '--from',
      CONVERSION_DIR,
      '--db',
      dbPath,
      '--json',
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim()).data.loaded).toHaveLength(6);

    const db = openDb(dbPath);
    const active = new SkillStore(db).list({ status: 'active' });
    db.close();
    expect(active).toHaveLength(6);
    expect(active.every((s) => s.tier === 'bundled')).toBe(true);
  });

  test('a missing source dir is NOT_FOUND (exit 9)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills-load-'));
    const { exitCode } = await run([
      'skills',
      'load',
      '--from',
      join(dir, 'nope'),
      '--db',
      join(dir, 'loom.db'),
      '--json',
    ]);
    expect(exitCode).toBe(9);
  });
});
