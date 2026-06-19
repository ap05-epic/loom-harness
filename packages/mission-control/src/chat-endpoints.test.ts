import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { LlmGateway, LlmResponse } from '@loom/agents';
import {
  ChatStore,
  MIGRATIONS,
  openDb,
  runMigrations,
  type Profile,
  type SqliteDatabase,
} from '@loom/core';
import { startMissionControl, type ChatRuntime, type MissionControl } from './index.js';

function scriptedGateway(script: LlmResponse[]): LlmGateway {
  let i = 0;
  return { complete: () => Promise.resolve(script[Math.min(i++, script.length - 1)]!) };
}
const text = (content: string): LlmResponse => ({
  content,
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1 },
  finishReason: 'stop',
});
const toolCall = (name: string, args: object): LlmResponse => ({
  content: null,
  toolCalls: [{ id: 'c1', name, arguments: JSON.stringify(args) }],
  usage: { inputTokens: 1, outputTokens: 1 },
  finishReason: 'tool_calls',
});

let db: SqliteDatabase;
let mc: MissionControl;
let root: string;

function runtime(script: LlmResponse[]): ChatRuntime {
  return {
    gateway: scriptedGateway(script),
    model: 'm',
    profile: {
      project: 'baa',
      dir: root,
      dataDir: root,
      env: {},
      llm: { driver: 'openai', model: 'm' },
    } as Profile,
    root,
    homeDir: root,
    version: '9.9.9',
  };
}

beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db, MIGRATIONS);
  root = mkdtempSync(join(tmpdir(), 'mc-chat-'));
});
afterEach(async () => {
  await mc?.stop();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  fetch(`${mc.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = (path: string) => fetch(`${mc.url}${path}`);

/** Read an SSE response into a list of {event,data}; `onEvent` can act mid-stream (the permission POST). */
async function readSse(
  res: Response,
  onEvent?: (ev: { event: string; data: any }) => Promise<void> | void,
): Promise<Array<{ event: string; data: any }>> {
  const events: Array<{ event: string; data: any }> = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev: { event: string; data: any } = { event: '', data: undefined };
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) ev.event = line.slice(6).trim();
        else if (line.startsWith('data:')) ev.data = JSON.parse(line.slice(5).trim());
      }
      if (!ev.event) continue;
      events.push(ev);
      await onEvent?.(ev);
      if (ev.event === 'done' || ev.event === 'error') return events;
    }
  }
  return events;
}

describe('Mission Control chat endpoints', () => {
  test('chat routes report 503 when no runtime is configured', async () => {
    mc = await startMissionControl({ db });
    expect((await get('/api/chat/sessions')).status).toBe(503);
  });

  test('creates, lists, and rehydrates a session', async () => {
    mc = await startMissionControl({ db, chat: runtime([text('hi')]) });
    const created = (await (await post('/api/chat/sessions', { project: 'baa' })).json()) as {
      id: string;
    };
    expect(created.id).toBeTruthy();
    const list = (await (await get('/api/chat/sessions?project=baa')).json()) as {
      sessions: unknown[];
    };
    expect(list.sessions).toHaveLength(1);
    const rehydrate = (await (await get(`/api/chat/sessions/${created.id}`)).json()) as {
      session: { id: string };
      messages: unknown[];
    };
    expect(rehydrate.session.id).toBe(created.id);
    expect(rehydrate.messages).toEqual([]);
  });

  test('a turn streams the assistant message + done and persists the conversation', async () => {
    mc = await startMissionControl({ db, chat: runtime([text('hello from loom')]) });
    const { id } = (await (await post('/api/chat/sessions', { project: 'baa' })).json()) as {
      id: string;
    };
    const events = await readSse(
      await post(`/api/chat/sessions/${id}/turn`, { input: 'hi there' }),
    );
    expect(events.some((e) => e.event === 'message' && e.data.content === 'hello from loom')).toBe(
      true,
    );
    expect(events.at(-1)?.event).toBe('done');
    const rehydrate = (await (await get(`/api/chat/sessions/${id}`)).json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(rehydrate.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(rehydrate.messages[0]?.content).toBe('hi there');
  });

  test('an expensive tool prompts for permission; approving it runs the tool', async () => {
    mc = await startMissionControl({
      db,
      chat: runtime([toolCall('write_file', { path: 'out.txt', content: 'hi' }), text('wrote it')]),
    });
    const { id } = (await (await post('/api/chat/sessions', { project: 'baa' })).json()) as {
      id: string;
    };
    const events = await readSse(
      await post(`/api/chat/sessions/${id}/turn`, { input: 'write a file' }),
      async (ev) => {
        if (ev.event === 'permission_request') {
          await post(`/api/chat/turns/${ev.data.turnId}/permission`, {
            requestId: ev.data.requestId,
            answer: 'yes',
          });
        }
      },
    );
    expect(
      events.some((e) => e.event === 'permission_request' && e.data.name === 'write_file'),
    ).toBe(true);
    expect(events.some((e) => e.event === 'tool_done' && e.data.name === 'write_file')).toBe(true);
    expect(events.at(-1)?.event).toBe('done');
    expect(existsSync(join(root, 'out.txt'))).toBe(true);
    expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('hi');
  });

  test('auto-compacts the conversation once the token trigger is crossed', async () => {
    mc = await startMissionControl({
      db,
      chat: {
        ...runtime([text('ok'), text('a running summary of earlier turns')]),
        compactTokenTrigger: 1,
      },
    });
    const { id } = (await (await post('/api/chat/sessions', { project: 'baa' })).json()) as {
      id: string;
    };
    // Pre-seed enough history that there is something older than the kept window to compact.
    new ChatStore(db).appendMessages(
      id,
      Array.from({ length: 8 }, (_unused, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `m${i}`,
      })),
    );
    const events = await readSse(await post(`/api/chat/sessions/${id}/turn`, { input: 'hello' }));
    expect(events.some((e) => e.event === 'compacted')).toBe(true);

    const { messages } = (await (await get(`/api/chat/sessions/${id}`)).json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(messages.length).toBeLessThan(10); // older turns collapsed
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('summarized');
  });

  test('lists profiles and switches the active one with no restart', async () => {
    mc = await startMissionControl({ db, chat: runtime([text('hi')]) });
    // The configured profile is active to start.
    const before = (await (await get('/api/profiles')).json()) as {
      active: string;
      profiles: Array<{ name: string; active: boolean }>;
    };
    expect(before.active).toBe('baa');
    expect(before.profiles.some((p) => p.name === 'baa' && p.active)).toBe(true);

    // Switch to a brand-new profile → its learning root is created on the fly.
    const sw = (await (await post('/api/profiles/active', { name: 'team-x' })).json()) as {
      active: string;
    };
    expect(sw.active).toBe('team-x');
    expect(existsSync(join(root, 'profiles', 'team-x', 'profile.db'))).toBe(true);

    // The status bar (chat/info) now reports the switched profile.
    const info = (await (await get('/api/chat/info')).json()) as { profile: string };
    expect(info.profile).toBe('team-x');

    // Switching back to the configured profile drops the override.
    const back = (await (await post('/api/profiles/active', { name: 'baa' })).json()) as {
      active: string;
    };
    expect(back.active).toBe('baa');
  });

  test('denying the permission prompt does not run the tool', async () => {
    mc = await startMissionControl({
      db,
      chat: runtime([toolCall('write_file', { path: 'nope.txt', content: 'x' }), text('skipped')]),
    });
    const { id } = (await (await post('/api/chat/sessions', { project: 'baa' })).json()) as {
      id: string;
    };
    await readSse(
      await post(`/api/chat/sessions/${id}/turn`, { input: 'write a file' }),
      async (ev) => {
        if (ev.event === 'permission_request') {
          await post(`/api/chat/turns/${ev.data.turnId}/permission`, {
            requestId: ev.data.requestId,
            answer: 'no',
          });
        }
      },
    );
    expect(existsSync(join(root, 'nope.txt'))).toBe(false);
  });
});
