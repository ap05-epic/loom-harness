import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { LlmGateway } from '@loom/agents';
import { MIGRATIONS, openDb, runMigrations, type Profile } from '@loom/core';
import { buildFsTools } from './fs-tools.js';
import type { ChatSession, ChatTool } from './session.js';

function session(root: string): ChatSession {
  const db = openDb(':memory:');
  runMigrations(db, MIGRATIONS);
  return {
    db,
    gateway: { complete: () => Promise.reject(new Error('no model')) } as LlmGateway,
    profile: {
      project: 'fixture',
      dir: resolve('/p'),
      dataDir: resolve('/d'),
      env: {},
      llm: { driver: 'openai', model: 'm' },
    } as Profile,
    version: '9.9.9',
    root,
  };
}

function run(tools: ChatTool[], name: string, args: unknown): Promise<string> {
  const t = tools.find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t.def.execute(args);
}

describe('write_file', () => {
  test('writes a file under the root (creating dirs) and is tagged expensive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-w-'));
    try {
      const tools = buildFsTools(session(dir));
      const out = await run(tools, 'write_file', {
        path: 'src/app.ts',
        content: 'export const x = 1;\n',
      });
      expect(out).toMatch(/wrote/i);
      expect(readFileSync(join(dir, 'src/app.ts'), 'utf8')).toContain('const x = 1');
      expect(tools.find((t) => t.def.name === 'write_file')?.risk).toBe('expensive');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses to escape the root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-w-'));
    try {
      const out = await run(buildFsTools(session(dir)), 'write_file', {
        path: '../../etc/evil',
        content: 'x',
      });
      expect(out).toMatch(/refused/i);
      expect(existsSync(join(dir, '../../etc/evil'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses protected paths (.env, .git, node_modules, loom.config.yaml) even inside the root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-w-'));
    try {
      const tools = buildFsTools(session(dir));
      for (const path of [
        '.env',
        '.env.production',
        '.git/config',
        'node_modules/x/index.js',
        'loom.config.yaml',
      ]) {
        const out = await run(tools, 'write_file', { path, content: 'x' });
        expect(out, `should refuse ${path}`).toMatch(/refused|protected/i);
      }
      expect(existsSync(join(dir, '.env'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('edit_file', () => {
  test('replaces an exact, unique substring', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-e-'));
    try {
      writeFileSync(join(dir, 'a.txt'), 'hello world\n');
      const out = await run(buildFsTools(session(dir)), 'edit_file', {
        path: 'a.txt',
        oldString: 'world',
        newString: 'loom',
      });
      expect(out).toMatch(/edited/i);
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hello loom\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses when the oldString is missing or not unique', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-e-'));
    try {
      writeFileSync(join(dir, 'a.txt'), 'aa aa aa');
      const tools = buildFsTools(session(dir));
      expect(
        await run(tools, 'edit_file', { path: 'a.txt', oldString: 'zzz', newString: 'y' }),
      ).toMatch(/no match/i);
      expect(
        await run(tools, 'edit_file', { path: 'a.txt', oldString: 'aa', newString: 'y' }),
      ).toMatch(/not unique|3 match/i);
      // unchanged
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('aa aa aa');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
