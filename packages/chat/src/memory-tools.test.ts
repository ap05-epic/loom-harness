import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { LlmGateway } from '@loom/agents';
import {
  MemoryStore,
  MIGRATIONS,
  openDb,
  ProfileStore,
  runMigrations,
  type Profile,
} from '@loom/core';
import { buildMemoryTools } from './memory-tools.js';
import type { ChatSession, ChatTool } from './session.js';

function session(): ChatSession {
  const db = openDb(':memory:');
  runMigrations(db, MIGRATIONS);
  return {
    db,
    gateway: { complete: () => Promise.reject(new Error('no model')) } as LlmGateway,
    profile: {
      project: 'baa',
      dir: resolve('/p'),
      dataDir: resolve('/d'),
      env: {},
      llm: { driver: 'openai', model: 'm' },
    } as Profile,
    version: '9.9.9',
    root: resolve('/p'),
  };
}

function run(tools: ChatTool[], name: string, args: unknown): Promise<string> {
  const t = tools.find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t.def.execute(args);
}

describe('memory tools', () => {
  test('memory_remember persists a project fact; memory_recall surfaces it by keyword', async () => {
    const s = session();
    const tools = buildMemoryTools(s);
    expect(
      await run(tools, 'memory_remember', { title: 'Dates', body: 'BAA dates render dd.MM.yyyy' }),
    ).toMatch(/remember/i);
    // persisted, scoped to the project
    expect(new MemoryStore(s.db).list('baa').some((m) => m.body.includes('dd.MM.yyyy'))).toBe(true);
    // recalled by a relevant keyword, excluded for an irrelevant one
    expect(await run(tools, 'memory_recall', { query: 'date format' })).toContain('dd.MM.yyyy');
    expect(await run(tools, 'memory_recall', { query: 'unrelated spaceship' })).toMatch(/nothing/i);
  });

  test('memory_recall is read-risk; memory_remember is safe-risk', () => {
    const tools = buildMemoryTools(session());
    expect(tools.find((t) => t.def.name === 'memory_recall')?.risk).toBe('read');
    expect(tools.find((t) => t.def.name === 'memory_remember')?.risk).toBe('safe');
  });

  test('memory_remember scope:profile writes to the profile store, not the project db', async () => {
    const home = mkdtempSync(join(tmpdir(), 'loom-home-'));
    try {
      const s = session();
      s.profileStore = new ProfileStore(home, 'baa');
      const tools = buildMemoryTools(s);
      await run(tools, 'memory_remember', {
        title: 'Voice',
        body: 'write verbs over adjectives',
        scope: 'profile',
      });
      // it landed in the profile store, NOT the project memory_index
      expect(s.profileStore.recall(['verbs']).some((m) => m.body.includes('verbs'))).toBe(true);
      expect(new MemoryStore(s.db).list('baa')).toHaveLength(0);
      // recall merges the profile tier
      expect(await run(tools, 'memory_recall', { query: 'voice verbs' })).toContain(
        'verbs over adjectives',
      );
      s.profileStore.close();
    } finally {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        /* windows file lock */
      }
    }
  });
});
