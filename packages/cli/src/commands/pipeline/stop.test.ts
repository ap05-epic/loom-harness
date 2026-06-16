import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { registerAll } from '../index.js';
import { buildProgram } from '../../program.js';

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

describe('loom stop', () => {
  test('writes a loom.stop flag next to the resolved db', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loom-stop-'));
    const { stdout, exitCode } = await run(['stop', '--db', join(dir, 'loom.db'), '--json']);
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout.trim());
    expect(env).toMatchObject({ ok: true, command: 'stop' });
    expect(existsSync(join(dir, 'loom.stop'))).toBe(true);
    expect(env.data.stopFlag).toBe(join(dir, 'loom.stop'));
  });
});
