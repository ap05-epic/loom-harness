import { buildRunReport } from '@loom/conductor';
import { openDb, TaskStore } from '@loom/core';
import { notFoundError } from '../../errors.js';
import { requireExistingDb } from '../../db-path.js';
import { defineCommand } from '../../registry.js';

export const reportCommand = defineCommand({
  name: 'report',
  group: 'observe',
  describe: 'Render the modernization report for a run (latest by default)',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  options: [
    { flags: '--db <path>', describe: 'path to loom.db (else --data-dir)' },
    { flags: '--run <id>', describe: 'run id (default: latest)' },
  ],
  examples: ['loom report', 'loom report --run run_abc123 --json'],
  run(ctx, input) {
    const db = openDb(requireExistingDb(ctx, input.options.db));
    try {
      const runId = (input.options.run as string | undefined) ?? new TaskStore(db).latestRun()?.id;
      if (!runId) throw notFoundError('run', 'latest', 'run `loom run` first');
      return { runId, report: buildRunReport(db, runId) };
    } finally {
      db.close();
    }
  },
  render(data, ctx) {
    ctx.sink.line((data as { report: string }).report);
  },
});
