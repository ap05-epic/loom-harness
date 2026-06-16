import { newId } from '../ids.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

export type QuestionStatus = 'open' | 'answered';

export type Question = {
  id: string;
  runId: string | null;
  wpId: string | null;
  question: string;
  context: unknown;
  status: QuestionStatus;
  answer: string | null;
};

type QuestionRow = {
  id: string;
  run_id: string | null;
  wp_id: string | null;
  question: string;
  context_json: string;
  status: QuestionStatus;
  answer: string | null;
};

const toQuestion = (r: QuestionRow): Question => ({
  id: r.id,
  runId: r.run_id,
  wpId: r.wp_id,
  question: r.question,
  context: JSON.parse(r.context_json),
  status: r.status,
  answer: r.answer,
});

/**
 * The agent-questions inbox: when an agent is blocked on something only a human can decide,
 * it asks here instead of guessing or thrashing. A shift keeps working non-blocked tasks while
 * questions wait. Mission Control (and `loom questions`) read open questions and answer them.
 */
export class QuestionStore {
  constructor(private readonly db: SqliteDatabase) {}

  ask(input: { runId?: string; wpId?: string; question: string; context?: unknown }): Question {
    const id = newId('q');
    this.db
      .prepare(
        'INSERT INTO agent_questions (id, run_id, wp_id, question, context_json) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.runId ?? null,
        input.wpId ?? null,
        input.question,
        JSON.stringify(input.context ?? {}),
      );
    return this.get(id)!;
  }

  get(id: string): Question | null {
    const r = this.db.prepare('SELECT * FROM agent_questions WHERE id = ?').get(id) as
      | QuestionRow
      | undefined;
    return r ? toQuestion(r) : null;
  }

  /** List questions (the inbox), oldest first, filterable by status / run / wp. */
  list(filter?: { status?: QuestionStatus; runId?: string; wpId?: string }): Question[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.runId) {
      clauses.push('run_id = ?');
      params.push(filter.runId);
    }
    if (filter?.wpId) {
      clauses.push('wp_id = ?');
      params.push(filter.wpId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM agent_questions ${where} ORDER BY created_at, rowid`)
      .all(...params) as QuestionRow[];
    return rows.map(toQuestion);
  }

  /** Record a human's answer and close the question. */
  answer(id: string, answer: string): Question {
    this.db
      .prepare(
        `UPDATE agent_questions SET answer = ?, status = 'answered',
         answered_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(answer, id);
    return this.get(id)!;
  }
}
