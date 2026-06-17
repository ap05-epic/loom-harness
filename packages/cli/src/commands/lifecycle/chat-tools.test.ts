import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { LlmGateway } from '@loom/agents';
import {
  GateStore,
  loadProfile,
  MIGRATIONS,
  openDb,
  QuestionStore,
  runMigrations,
  TaskStore,
  type Profile,
} from '@loom/core';
import { buildChatTools, type ChatSession } from './chat-tools.js';

function session(over: Partial<ChatSession> = {}): ChatSession {
  const db = openDb(':memory:');
  runMigrations(db, MIGRATIONS);
  return {
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
    ...over,
  };
}

function run(s: ChatSession, name: string, args: unknown = {}): Promise<string> {
  const t = buildChatTools(s).find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t.def.execute(args);
}

describe('chat tools — read + inbox', () => {
  test('status summarizes the latest run', async () => {
    const s = session();
    const tasks = new TaskStore(s.db);
    const r = tasks.createRun({ project: 'fixture' });
    const wp = tasks.createWorkPackage({ runId: r.id, screenKey: 'login', title: 'Login' });
    tasks.setWorkPackageState(wp.id, 'passed');
    const out = await run(s, 'status');
    expect(out).toContain(r.id);
    expect(out).toMatch(/passed 1/);
  });

  test('status with no runs is friendly', async () => {
    expect(await run(session(), 'status')).toMatch(/No runs yet/i);
  });

  test('approve_gate decides an open gate', async () => {
    const s = session();
    const tasks = new TaskStore(s.db);
    const r = tasks.createRun({ project: 'fixture' });
    const wp = tasks.createWorkPackage({ runId: r.id, screenKey: 'login', title: 'Login' });
    const gate = new GateStore(s.db).open({ scopeType: 'wp', scopeId: wp.id, type: 'ship' });
    expect(await run(s, 'approve_gate', { id: gate.id })).toMatch(/approved/i);
    expect(new GateStore(s.db).get(gate.id)?.status).toBe('approved');
  });

  test('approve_gate on an unknown id is friendly', async () => {
    expect(await run(session(), 'approve_gate', { id: 'nope' })).toMatch(/no open gate/i);
  });

  test('answer_question answers an open question', async () => {
    const s = session();
    const q = new QuestionStore(s.db).ask({ question: 'dd.MM or MM/dd?' });
    expect(await run(s, 'answer_question', { id: q.id, answer: 'dd.MM.yyyy' })).toMatch(
      /answered/i,
    );
    expect(new QuestionStore(s.db).get(q.id)?.status).toBe('answered');
  });

  test('list_gates / list_questions report emptiness', async () => {
    const s = session();
    expect(await run(s, 'list_gates')).toMatch(/no open gates/i);
    expect(await run(s, 'list_questions')).toMatch(/no open questions/i);
  });
});

describe('chat tools — pipeline tools degrade gracefully on a minimal profile', () => {
  test('map returns a friendly config message when source.strutsConfig is missing', async () => {
    const out = await run(session(), 'map');
    expect(out).toMatch(/can't map yet/i);
    expect(out).toMatch(/struts/i);
  });

  test('run returns a friendly config message on a minimal profile', async () => {
    expect(await run(session(), 'run')).toMatch(/can't run yet/i);
  });
});

describe('chat tools — conversational project setup', () => {
  test('configure_project writes the profile so the project becomes runnable', async () => {
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
      // and it persisted to disk
      expect(loadProfile(join(tmp, 'profile'), { env: {} }).app?.baseUrl).toBe(
        'http://legacy.app/',
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('show_profile reports what is missing on a minimal profile', async () => {
    const out = await run(session(), 'show_profile');
    expect(out).toMatch(/project: fixture/);
    expect(out).toMatch(/not runnable yet/i);
  });
});
