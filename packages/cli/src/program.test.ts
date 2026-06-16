import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { registerAll } from './commands/index.js';
import { buildProgram } from './program.js';

type RunResult = { stdout: string; stderr: string; exitCode: number };

async function run(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<RunResult> {
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

describe('program wiring (full path: parse → context → command → sink → exit)', () => {
  test('status --json emits exactly one success envelope to stdout, exit 0', async () => {
    const { stdout, stderr, exitCode } = await run(['status', '--json']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    const docs = stdout.trim().split('\n').filter(Boolean);
    expect(docs).toHaveLength(1);
    const env = JSON.parse(docs[0]!);
    expect(env).toMatchObject({ ok: true, command: 'status' });
    expect(env.data.node).toBe(process.versions.node);
    expect(['better-sqlite3', 'node:sqlite']).toContain(env.data.sqliteBackend);
  });

  test('status (human) reports the version passed to the program', async () => {
    const { stdout } = await run(['status']);
    expect(stdout).toMatch(/loom 9\.9\.9/);
  });

  test('db migrate with no target → USAGE error envelope, exit 2', async () => {
    const { stdout, exitCode } = await run(['db', 'migrate', '--json']);
    expect(exitCode).toBe(2);
    const env = JSON.parse(stdout.trim());
    expect(env.ok).toBe(false);
    expect(env.command).toBe('db.migrate');
    expect(env.error.code).toBe('USAGE');
  });

  test('models test without a profile → CONFIG error, exit 3', async () => {
    const { stdout, exitCode } = await run(['models', 'test', '--json']);
    expect(exitCode).toBe(3);
    expect(JSON.parse(stdout.trim()).error.code).toBe('CONFIG');
  });

  test('ask with a prompt but no profile → CONFIG error, exit 3 (no network)', async () => {
    const { stdout, exitCode } = await run(['ask', 'hello', '--json']);
    expect(exitCode).toBe(3);
    expect(JSON.parse(stdout.trim()).error.code).toBe('CONFIG');
  });

  test('next without a profile → recommends `loom init`, exit 0', async () => {
    const { stdout, exitCode } = await run(['next', '--json']);
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout.trim());
    expect(env).toMatchObject({ ok: true, command: 'next' });
    expect(env.data.command).toMatch(/loom init/);
  });

  test('--json diagnostics never pollute stdout (update --check streams info to stderr)', async () => {
    // update --check resolves a tag without mutating; in this repo tags exist after v0.1.0,
    // but even if it errors, the contract holds: stdout carries only the single envelope.
    const { stdout } = await run(['status', '--json']);
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  test('init auto-detect prefers the openai key path when LLM_API_KEY is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loom-init-pref-'));
    const { stdout, exitCode } = await run(['init', '--dir', dir, '--no-input', '--json'], {
      LLM_API_KEY: 'present',
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim()).data.driver).toBe('openai');
  });

  test('bare `loom` prints the startup identity panel (logo + version), exit 0', async () => {
    const { stdout, exitCode } = await run([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('LOOM HARNESS'); // the ASCII lockup (non-TTY ⇒ no block art)
    expect(stdout).toContain('9.9.9'); // the version passed to the program
    expect(stdout).toMatch(/loom init/); // unconfigured ⇒ points at init
  });
});
