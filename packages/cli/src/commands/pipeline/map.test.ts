import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { registerAll } from '../index.js';
import { buildProgram } from '../../program.js';

const STRUTS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
  'WEB-INF',
  'struts-config.xml',
);

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

describe('loom map (against the fixture struts-config)', () => {
  test('maps every fixture screen and emits a clean --json envelope', async () => {
    const atlas = join(mkdtempSync(join(tmpdir(), 'cli-map-')), 'codeatlas.db');
    const { stdout, stderr, exitCode } = await run([
      'map',
      '--struts',
      STRUTS,
      '--atlas',
      atlas,
      '--json',
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    const env = JSON.parse(stdout.trim());
    expect(env).toMatchObject({ ok: true, command: 'map' });
    const keys = (env.data.screens as Array<{ key: string }>).map((s) => s.key).sort();
    expect(keys).toEqual(['list', 'login', 'logout', 'popup', 'wizard']);
    const login = (env.data.screens as Array<{ key: string; actionPath: string }>).find(
      (s) => s.key === 'login',
    );
    expect(login?.actionPath).toBe('/login');
  });

  test('re-running map is idempotent (no duplicate screens)', async () => {
    const atlas = join(mkdtempSync(join(tmpdir(), 'cli-map-')), 'codeatlas.db');
    await run(['map', '--struts', STRUTS, '--atlas', atlas, '--json']);
    const { stdout } = await run(['map', '--struts', STRUTS, '--atlas', atlas, '--json']);
    const env = JSON.parse(stdout.trim());
    expect((env.data.screens as unknown[]).length).toBe(5);
  });

  test('a missing struts-config is a NOT_FOUND error (exit 9)', async () => {
    const { stdout, exitCode } = await run([
      'map',
      '--struts',
      join(tmpdir(), 'does-not-exist.xml'),
      '--atlas',
      join(tmpdir(), 'x.db'),
      '--json',
    ]);
    expect(exitCode).toBe(9);
    expect(JSON.parse(stdout.trim()).error.code).toBe('NOT_FOUND');
  });
});
