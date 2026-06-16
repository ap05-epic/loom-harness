import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkillDir, writeSkillFile } from '@loom/skills';
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

/** A minimal profile whose `skills.dir` points at `skillsDir` (no LLM key needed). */
function profileDir(skillsDir: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-skills-profile-'));
  writeFileSync(
    join(dir, 'harness.config.yaml'),
    [
      'project: fixture',
      'llm:',
      '  driver: copilot',
      '  model: mock',
      'skills:',
      `  dir: ${skillsDir.replace(/\\/g, '/')}`,
      '',
    ].join('\n'),
  );
  return dir;
}

describe('loom skills export/import (DIGIT round-trip)', () => {
  test('exports the project library and imports it back identically', async () => {
    const src = mkdtempSync(join(tmpdir(), 'skills-src-'));
    writeSkillFile(src, {
      name: 'tiles-layout',
      description: 'tiles → layout',
      triggers: ['tiles'],
      body: 'Step.',
    });
    writeSkillFile(src, {
      name: 'iterate-table',
      description: 'iterate → table',
      triggers: ['logic:iterate'],
      body: 'Step.',
    });
    const env = { HARNESS_PROFILE: profileDir(src) };

    const digit = mkdtempSync(join(tmpdir(), 'skills-digit-'));
    const exp = await run(['skills', 'export', '--target', 'digit', '--out', digit, '--json'], env);
    expect(exp.exitCode).toBe(0);
    expect(JSON.parse(exp.stdout.trim()).data.exported).toEqual(['iterate-table', 'tiles-layout']);

    // Import the DIGIT-format directory back into a fresh project library.
    const dest = mkdtempSync(join(tmpdir(), 'skills-dest-'));
    const imp = await run(['skills', 'import', '--from', digit, '--out', dest, '--json'], env);
    expect(imp.exitCode).toBe(0);
    expect(JSON.parse(imp.stdout.trim()).data.imported).toEqual(['iterate-table', 'tiles-layout']);
    // The round-trip is faithful: the destination loads to the same docs as the source.
    expect(loadSkillDir(dest)).toEqual(loadSkillDir(src));
  });

  test('export defaults its source to the profile’s skills.dir', async () => {
    const src = mkdtempSync(join(tmpdir(), 'skills-src2-'));
    writeSkillFile(src, {
      name: 'popup-modal',
      description: 'popup → modal',
      triggers: ['popup'],
      body: 'Step.',
    });
    const env = { HARNESS_PROFILE: profileDir(src) };
    const out = mkdtempSync(join(tmpdir(), 'skills-out2-'));
    const res = await run(['skills', 'export', '--out', out, '--json'], env);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout.trim()).data.exported).toEqual(['popup-modal']);
  });

  test('an unsupported export target is a usage error (exit 2)', async () => {
    const env = { HARNESS_PROFILE: profileDir(mkdtempSync(join(tmpdir(), 'skills-empty-'))) };
    const out = mkdtempSync(join(tmpdir(), 'o-'));
    const res = await run(['skills', 'export', '--target', 'foo', '--out', out, '--json'], env);
    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stdout.trim()).error.code).toBe('USAGE');
  });

  test('export without --out is a usage error (exit 2)', async () => {
    const env = { HARNESS_PROFILE: profileDir(mkdtempSync(join(tmpdir(), 'skills-empty2-'))) };
    const res = await run(['skills', 'export', '--json'], env);
    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stdout.trim()).error.code).toBe('USAGE');
  });

  test('import without --from is a usage error (exit 2)', async () => {
    const env = { HARNESS_PROFILE: profileDir(mkdtempSync(join(tmpdir(), 'skills-empty3-'))) };
    const res = await run(['skills', 'import', '--json'], env);
    expect(res.exitCode).toBe(2);
    expect(JSON.parse(res.stdout.trim()).error.code).toBe('USAGE');
  });

  test('show prints one skill (name, triggers, body) by name', async () => {
    const src = mkdtempSync(join(tmpdir(), 'skills-show-'));
    writeSkillFile(src, {
      name: 'tiles-layout',
      description: 'tiles → layout',
      triggers: ['tiles'],
      body: 'Do the thing.',
    });
    const env = { HARNESS_PROFILE: profileDir(src) };
    const res = await run(['skills', 'show', 'tiles-layout', '--json'], env);
    expect(res.exitCode).toBe(0);
    const d = JSON.parse(res.stdout.trim()).data;
    expect(d.name).toBe('tiles-layout');
    expect(d.triggers).toEqual(['tiles']);
    expect(d.body).toContain('Do the thing.');
  });

  test('show on an unknown skill is NOT_FOUND (exit 9)', async () => {
    const env = { HARNESS_PROFILE: profileDir(mkdtempSync(join(tmpdir(), 'skills-show-empty-'))) };
    const res = await run(['skills', 'show', 'nope', '--json'], env);
    expect(res.exitCode).toBe(9);
    expect(JSON.parse(res.stdout.trim()).error.code).toBe('NOT_FOUND');
  });
});
