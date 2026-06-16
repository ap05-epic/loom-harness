import { openDb, QuestionStore, type QuestionStatus } from '@loom/core';
import { notFoundError, usageError } from '../../errors.js';
import { requireExistingDb } from '../../db-path.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';

const DB_OPT = { flags: '--db <path>', describe: 'path to loom.db (else --data-dir)' };

type QRow = { id: string; wpId: string | null; question: string; status: string };

export const questionsListCommand = defineCommand({
  name: 'questions list',
  group: 'work',
  describe: 'List agent questions awaiting a human answer',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  options: [DB_OPT, { flags: '--status <status>', describe: 'filter by status (default: open)' }],
  examples: ['loom questions list --data-dir ./.loom-data', 'loom questions list --json'],
  run(ctx, input) {
    const db = openDb(requireExistingDb(ctx, input.options.db));
    try {
      const status = (input.options.status as QuestionStatus | undefined) ?? 'open';
      const questions: QRow[] = new QuestionStore(db).list({ status }).map((q) => ({
        id: q.id,
        wpId: q.wpId,
        question: q.question,
        status: q.status,
      }));
      return { questions };
    } finally {
      db.close();
    }
  },
  render(data, ctx) {
    const d = data as { questions: QRow[] };
    if (d.questions.length === 0) {
      ctx.sink.line('no questions');
      return;
    }
    ctx.sink.line(
      renderTable(
        d.questions.map((q) => ({
          id: q.id,
          wp: q.wpId ?? '-',
          status: q.status,
          question: q.question,
        })),
        [
          { key: 'id', header: 'ID' },
          { key: 'wp', header: 'WP' },
          { key: 'status', header: 'STATUS' },
          { key: 'question', header: 'QUESTION' },
        ],
      ),
    );
  },
});

export const questionsAnswerCommand = defineCommand({
  name: 'questions answer',
  group: 'work',
  describe: 'Answer an open agent question (unblocks the work that asked it)',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  args: [{ name: 'id', describe: 'question id', required: true }],
  options: [DB_OPT, { flags: '--answer <text>', describe: 'the answer (required)' }],
  examples: ['loom questions answer q_abc123 --answer "use dd.MM.yyyy" --json'],
  run(ctx, input) {
    const answer = input.options.answer as string | undefined;
    if (!answer) throw usageError('an answer is required', 'pass --answer "<text>"');
    const db = openDb(requireExistingDb(ctx, input.options.db));
    try {
      const store = new QuestionStore(db);
      const id = input.args.id as string;
      const q = store.get(id);
      if (!q || q.status !== 'open') {
        throw notFoundError('open question', id, 'see `loom questions list`');
      }
      store.answer(id, answer);
      return { id, status: 'answered' };
    } finally {
      db.close();
    }
  },
  render(data, ctx) {
    const d = data as { id: string };
    ctx.sink.line(`question ${d.id} answered`);
  },
});
