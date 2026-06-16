import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildProgram } from '../../program.js';
import { registerAll } from '../index.js';

type RunResult = { stdout: string; exitCode: number };
async function run(args: string[]): Promise<RunResult> {
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

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'proj-ws-'));
  mkdirSync(join(ws, 'projects', 'baa'), { recursive: true });
  mkdirSync(join(ws, 'projects', 'claims'), { recursive: true });
  writeFileSync(
    join(ws, 'loom-workspace.yaml'),
    [
      'version: 1',
      'active: baa',
      'projects:',
      '  - { name: baa, dir: projects/baa }',
      '  - { name: claims, dir: projects/claims }',
      '',
    ].join('\n'),
  );
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe('loom project', () => {
  test('list shows the projects and which is active', async () => {
    const { stdout, exitCode } = await run(['project', 'list', '--json', '--workspace', ws]);
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout.trim());
    expect(env.data.active).toBe('baa');
    expect(env.data.projects.map((p: { name: string }) => p.name)).toEqual(['baa', 'claims']);
  });

  test('use switches the active project and persists it', async () => {
    const { exitCode } = await run(['project', 'use', 'claims', '--workspace', ws]);
    expect(exitCode).toBe(0);
    expect(readFileSync(join(ws, 'loom-workspace.yaml'), 'utf8')).toContain('active: claims');
  });

  test('use rejects an unknown project with NOT_FOUND (exit 9)', async () => {
    const { exitCode } = await run(['project', 'use', 'nope', '--json', '--workspace', ws]);
    expect(exitCode).toBe(9);
  });

  test('current resolves the active project to its own dirs', async () => {
    const { stdout } = await run(['project', 'current', '--json', '--workspace', ws]);
    const env = JSON.parse(stdout.trim());
    expect(env.data.project).toBe('baa');
    expect(env.data.dataDir).toContain(join('projects', 'baa', 'data'));
  });

  test('new scaffolds a project (and the workspace) and registers it', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'fresh-ws-'));
    try {
      const { exitCode } = await run(['project', 'new', 'demo', '--workspace', fresh]);
      expect(exitCode).toBe(0);
      expect(existsSync(join(fresh, 'projects', 'demo', 'loom.config.yaml'))).toBe(true);
      expect(existsSync(join(fresh, 'projects', 'demo', 'data'))).toBe(true);
      const manifest = readFileSync(join(fresh, 'loom-workspace.yaml'), 'utf8');
      expect(manifest).toContain('name: demo');
      expect(manifest).toContain('active: demo'); // first project becomes active
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test('new rejects a duplicate project name (USAGE, exit 2)', async () => {
    const { exitCode } = await run(['project', 'new', 'baa', '--json', '--workspace', ws]);
    expect(exitCode).toBe(2);
  });
});
