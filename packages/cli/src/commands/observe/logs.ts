import { EventLog, openDb } from '@loom/core';
import { requireExistingDb } from '../../db-path.js';
import { defineCommand } from '../../registry.js';

type LogRow = {
  id: number;
  ts: string;
  type: string;
  wpId: string | null;
  attemptId: string | null;
  payload: unknown;
};

export const logsCommand = defineCommand({
  name: 'logs',
  group: 'observe',
  describe: 'Tail the append-only harness event log',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  options: [
    { flags: '--db <path>', describe: 'path to loom.db (else --data-dir)' },
    { flags: '--run <id>', describe: 'filter to one run' },
    { flags: '--wp <id>', describe: 'filter to one work package' },
    { flags: '--since <id>', describe: 'only events after this id (default 0)' },
    { flags: '--limit <n>', describe: 'max events (default 100)' },
  ],
  examples: ['loom logs --data-dir ./.loom-data', 'loom logs --run run_x --limit 50 --json'],
  run(ctx, input) {
    const db = openDb(requireExistingDb(ctx, input.options.db));
    try {
      const log = new EventLog(db);
      const since = input.options.since !== undefined ? Number(input.options.since) : 0;
      const limit = input.options.limit !== undefined ? Number(input.options.limit) : 100;
      const runId = input.options.run as string | undefined;
      const wpId = input.options.wp as string | undefined;
      const filter = runId || wpId ? { runId, wpId } : undefined;
      const events: LogRow[] = log.tailFrom(since, limit, filter).map((e) => ({
        id: e.id,
        ts: e.ts,
        type: e.type,
        wpId: e.wpId,
        attemptId: e.attemptId,
        payload: e.payload,
      }));
      return { events };
    } finally {
      db.close();
    }
  },
  render(data, ctx) {
    const d = data as { events: LogRow[] };
    if (d.events.length === 0) {
      ctx.sink.line('no events');
      return;
    }
    for (const e of d.events) {
      const scope = e.wpId ? ` ${e.wpId}` : '';
      ctx.sink.line(`${e.ts}  ${e.type}${scope}`);
    }
  },
});
