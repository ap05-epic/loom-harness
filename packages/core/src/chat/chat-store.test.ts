import { describe, expect, test } from 'vitest';
import { openDb, runMigrations } from '../db/db.js';
import { MIGRATIONS } from '../db/migrations.js';
import { ChatStore } from './chat-store.js';

function store(): ChatStore {
  const db = openDb(':memory:');
  runMigrations(db, MIGRATIONS);
  return new ChatStore(db);
}

describe('ChatStore', () => {
  test('creates a session and reads it back', () => {
    const s = store();
    const sess = s.createSession({ project: 'baa', title: 'first chat' });
    expect(sess.project).toBe('baa');
    expect(sess.title).toBe('first chat');
    expect(s.getSession(sess.id)?.id).toBe(sess.id);
    expect(s.getSession('nope')).toBeNull();
  });

  test('appends messages with increasing seq across calls, preserving role + tool fields', () => {
    const s = store();
    const sess = s.createSession({ project: 'baa' });
    const first = s.appendMessages(sess.id, [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'c1', name: 'status', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: 'c1', content: 'ok' },
    ]);
    expect(first.map((m) => m.seq)).toEqual([1, 2, 3]);
    s.appendMessages(sess.id, [{ role: 'assistant', content: 'done' }]);

    const msgs = s.listMessages(sess.id);
    expect(msgs.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(msgs[1]?.content).toBeNull();
    expect(msgs[1]?.toolCalls).toEqual([{ id: 'c1', name: 'status', arguments: '{}' }]);
    expect(msgs[2]).toMatchObject({ role: 'tool', toolCallId: 'c1', content: 'ok' });
    expect(msgs[3]).toMatchObject({ role: 'assistant', content: 'done' });
  });

  test('listSessions is scoped to project and returns the most recently created first', () => {
    const s = store();
    s.createSession({ project: 'p1' });
    const second = s.createSession({ project: 'p1' });
    s.createSession({ project: 'other' });
    const list = s.listSessions('p1');
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(second.id); // newest-first
  });

  test('appendMessages bumps the session updated_at (>= created_at)', () => {
    const s = store();
    const sess = s.createSession({ project: 'p' });
    s.appendMessages(sess.id, [{ role: 'user', content: 'hello' }]);
    const after = s.getSession(sess.id)!;
    expect(after.updatedAt >= after.createdAt).toBe(true);
  });

  test('compact replaces older messages with a summary, keeping the last N', () => {
    const s = store();
    const sess = s.createSession({ project: 'p' });
    s.appendMessages(sess.id, [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
      { role: 'user', content: 'five' },
    ]);
    const compacted = s.compact(sess.id, 2, 'summary: discussed 1-3');
    // a summary system message + the last 2, renumbered from 1
    expect(compacted.map((m) => m.role)).toEqual(['system', 'assistant', 'user']);
    expect(compacted[0]?.content).toContain('summary: discussed 1-3');
    expect(compacted.map((m) => m.content)).toEqual(['summary: discussed 1-3', 'four', 'five']);
    expect(compacted.map((m) => m.seq)).toEqual([1, 2, 3]);
    // appending after compaction continues the new seq
    const more = s.appendMessages(sess.id, [{ role: 'user', content: 'six' }]);
    expect(more[0]?.seq).toBe(4);
  });

  test('compact is a no-op when there is nothing older than keepLast', () => {
    const s = store();
    const sess = s.createSession({ project: 'p' });
    s.appendMessages(sess.id, [{ role: 'user', content: 'a' }]);
    expect(s.compact(sess.id, 5, 'x').map((m) => m.content)).toEqual(['a']);
  });
});
