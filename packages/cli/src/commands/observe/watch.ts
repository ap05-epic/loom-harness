import {
  EventLog,
  GateStore,
  QuestionStore,
  TaskStore,
  openDb,
  type HarnessEvent,
} from '@loom/core';
import { requireExistingDb } from '../../db-path.js';
import { defineCommand } from '../../registry.js';
import { renderWatchFrame, type WatchFrameInput } from '../../ui/watch.js';

/** Latest heartbeat age (ms) from a run's event tail, or null if none yet. */
function heartbeatAgeMs(events: HarnessEvent[], now: number): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === 'heartbeat') {
      const t = Date.parse(events[i]!.ts);
      return Number.isNaN(t) ? null : Math.max(0, now - t);
    }
  }
  return null;
}

export const watchCommand = defineCommand({
  name: 'watch',
  group: 'observe',
  describe:
    'A single-glance dashboard of the active run — stage, screen tally, budgets, inbox, "is it wedged?"',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  options: [
    { flags: '--db <path>', describe: 'path to loom.db (else --data-dir)' },
    { flags: '--run <id>', describe: 'watch a specific run (default: latest)' },
  ],
  examples: ['loom watch --data-dir ./.loom-data', 'loom watch --json'],
  run(ctx, input) {
    const db = openDb(requireExistingDb(ctx, input.options.db));
    try {
      const tasks = new TaskStore(db);
      const runId = input.options.run as string | undefined;
      const run = runId
        ? tasks.getRun(runId)
        : (tasks.latestRun({ status: 'running' }) ?? tasks.latestRun());
      if (!run) {
        return {
          version: ctx.version,
          project: '—',
          run: null,
          screens: [],
          tokens: null,
          gatesOpen: 0,
          questionsOpen: 0,
          heartbeatAgeMs: null,
          recent: [],
        } satisfies WatchFrameInput;
      }
      const events = new EventLog(db).tailFrom(0, 5000, { runId: run.id });
      const usage = tasks.usageRollup(run.id);
      return {
        version: ctx.version,
        project: run.project,
        run: { id: run.id, status: run.status, stage: run.stage },
        screens: tasks
          .listWorkPackages(run.id)
          .map((w) => ({ screenKey: w.screenKey, state: w.state })),
        tokens: usage.inputTokens + usage.outputTokens,
        gatesOpen: new GateStore(db).list({ status: 'open' }).length,
        questionsOpen: new QuestionStore(db).list({ status: 'open' }).length,
        heartbeatAgeMs: heartbeatAgeMs(events, Date.now()),
        recent: events.slice(-8).map((e) => ({ ts: e.ts, type: e.type, wpId: e.wpId })),
      } satisfies WatchFrameInput;
    } finally {
      db.close();
    }
  },
  render(data, ctx) {
    ctx.sink.line(renderWatchFrame(data as WatchFrameInput));
  },
});
