import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { LlmGateway } from '@loom/agents';
import { buildChatTools, type ChatSession } from '@loom/chat';
import { MIGRATIONS, openDb, runMigrations, type Profile } from '@loom/core';
import { buildPipelineTools, chatReadiness } from './chat-pipeline-tools.js';

function session(over: Partial<ChatSession> = {}): ChatSession {
  const db = openDb(':memory:');
  runMigrations(db, MIGRATIONS);
  const s: ChatSession = {
    db,
    gateway: { complete: () => Promise.reject(new Error('no model in test')) } as LlmGateway,
    profile: {
      project: 'fixture',
      dir: resolve('/p'),
      dataDir: resolve('/d'),
      env: {},
      llm: { driver: 'openai', model: 'm' },
    } as Profile,
    version: '9.9.9',
    root: resolve('/p'),
    commands: [{ name: 'explore', describe: 'walk the running app' }],
    ...over,
  };
  s.readiness = chatReadiness(s);
  return s;
}

function run(s: ChatSession, name: string, args: unknown = {}): Promise<string> {
  const t = buildChatTools(s, { extraTools: buildPipelineTools(s) }).find(
    (x) => x.def.name === name,
  );
  if (!t) throw new Error(`no tool ${name}`);
  return t.def.execute(args);
}

describe('chat pipeline tools (CLI-injected extraTools)', () => {
  test('map returns a friendly config message when source.strutsConfig is missing', async () => {
    const out = await run(session(), 'map');
    expect(out).toMatch(/can't map yet/i);
    expect(out).toMatch(/struts/i);
  });

  test('run returns a friendly config message on a minimal profile', async () => {
    expect(await run(session(), 'run')).toMatch(/can't run yet/i);
  });

  test('configure_project + the readiness seam make the project runnable', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'chat-cfg-'));
    try {
      const s = session({
        profile: {
          project: 'baa',
          dir: join(tmp, 'profile'),
          dataDir: tmp,
          env: {},
          llm: { driver: 'openai', model: 'm' },
        } as Profile,
      });
      // a bare profile can't run yet (no source/app)
      expect(await run(s, 'map')).toMatch(/can't map yet/i);
      // set the two required fields conversationally
      const out = await run(s, 'configure_project', {
        strutsConfig: join(tmp, 'struts-config.xml'),
        baseUrl: 'http://legacy.app/',
      });
      expect(out).toMatch(/saved/i);
      // the session reloaded its profile → now runnable (map fails on the missing file, not config)
      expect(await run(s, 'map')).not.toMatch(/can't map yet/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('list_commands surfaces the CLI command list (full composition)', async () => {
    expect(await run(session(), 'list_commands')).toMatch(/explore/);
  });
});
