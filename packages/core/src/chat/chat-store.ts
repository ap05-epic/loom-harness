import { newId } from '../ids.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

/** A persisted browser-chat conversation, scoped to one project. */
export type ChatSession = {
  id: string;
  project: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * One persisted message. The persistence shape is deliberately decoupled from `@loom/agents`'
 * `ChatMessage` (so `@loom/core` need not depend on `@loom/agents`): the server maps between them.
 * `toolCalls` carries an assistant turn's tool calls; `toolCallId` carries a tool result's id.
 */
export type ChatMessageRecord = {
  id: string;
  sessionId: string;
  seq: number;
  role: ChatRole;
  content: string | null;
  toolCalls: unknown | null;
  toolCallId: string | null;
  ts: string;
};

/** The input shape for {@link ChatStore.appendMessages} — the store assigns id/seq/ts. */
export type ChatMessageInput = {
  role: ChatRole;
  content?: string | null;
  toolCalls?: unknown;
  toolCallId?: string | null;
};

type SessionRow = {
  id: string;
  project: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  seq: number;
  role: ChatRole;
  content: string | null;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  ts: string;
};

const toSession = (r: SessionRow): ChatSession => ({
  id: r.id,
  project: r.project,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toRecord = (r: MessageRow): ChatMessageRecord => ({
  id: r.id,
  sessionId: r.session_id,
  seq: r.seq,
  role: r.role,
  content: r.content,
  toolCalls: r.tool_calls_json == null ? null : JSON.parse(r.tool_calls_json),
  toolCallId: r.tool_call_id,
  ts: r.ts,
});

/**
 * The durable store behind the browser Generic Chat surface: conversations (`chat_sessions`) and
 * their messages (`chat_messages`). It is an orthogonal store the conductor never reads or writes —
 * so it doesn't engage the conductor's single-writer rule; the Mission Control server owns it. A
 * turn's tail is committed in one transaction (commit-on-done), so the store never holds a torn turn.
 */
export class ChatStore {
  constructor(private readonly db: SqliteDatabase) {}

  createSession(input: { project: string; title?: string }): ChatSession {
    const id = newId('chat');
    this.db
      .prepare('INSERT INTO chat_sessions (id, project, title) VALUES (?, ?, ?)')
      .run(id, input.project, input.title ?? null);
    return this.getSession(id)!;
  }

  getSession(id: string): ChatSession | null {
    const r = this.db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return r ? toSession(r) : null;
  }

  /** A project's conversations, most recently active first. */
  listSessions(project: string): ChatSession[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_sessions WHERE project = ? ORDER BY updated_at DESC, rowid DESC')
      .all(project) as SessionRow[];
    return rows.map(toSession);
  }

  /** Name (or rename) a conversation — used to set a title from its first user message. */
  setTitle(id: string, title: string): void {
    this.db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(title, id);
  }

  listMessages(sessionId: string): ChatMessageRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY seq')
      .all(sessionId) as MessageRow[];
    return rows.map(toRecord);
  }

  /**
   * Append a turn's messages atomically, continuing the session's seq, and bump its `updated_at`.
   * Returns the inserted records. One transaction → a crash mid-append leaves no torn turn.
   */
  appendMessages(sessionId: string, messages: ChatMessageInput[]): ChatMessageRecord[] {
    const startSeq = (
      this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM chat_messages WHERE session_id = ?')
        .get(sessionId) as { m: number }
    ).m;
    const insert = this.db.prepare(
      'INSERT INTO chat_messages (id, session_id, seq, role, content, tool_calls_json, tool_call_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const bump = this.db.prepare(
      "UPDATE chat_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    );
    this.db.transaction(() => {
      let seq = startSeq;
      for (const m of messages) {
        seq += 1;
        insert.run(
          newId('msg'),
          sessionId,
          seq,
          m.role,
          m.content ?? null,
          m.toolCalls == null ? null : JSON.stringify(m.toolCalls),
          m.toolCallId ?? null,
        );
      }
      bump.run(sessionId);
    })();
    return this.listMessages(sessionId).filter((m) => m.seq > startSeq);
  }

  /**
   * Auto-compaction: replace everything older than the last `keepLast` messages with a single summary
   * system message, renumbering from 1. Keeps a long conversation from overflowing the model context
   * while leaving the recent turns intact. No-op when there's nothing older than `keepLast`.
   */
  compact(sessionId: string, keepLast: number, summary: string): ChatMessageRecord[] {
    const msgs = this.listMessages(sessionId);
    if (msgs.length <= keepLast) return msgs;
    const kept = keepLast > 0 ? msgs.slice(-keepLast) : [];
    const insert = this.db.prepare(
      'INSERT INTO chat_messages (id, session_id, seq, role, content, tool_calls_json, tool_call_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
      insert.run(newId('msg'), sessionId, 1, 'system', summary, null, null);
      let seq = 1;
      for (const m of kept) {
        seq += 1;
        insert.run(
          newId('msg'),
          sessionId,
          seq,
          m.role,
          m.content,
          m.toolCalls == null ? null : JSON.stringify(m.toolCalls),
          m.toolCallId,
        );
      }
    })();
    return this.listMessages(sessionId);
  }
}
