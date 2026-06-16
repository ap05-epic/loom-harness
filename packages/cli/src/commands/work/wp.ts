import { openDb, TaskStore, type WpState } from '@loom/core';
import { notFoundError } from '../../errors.js';
import { requireExistingDb } from '../../db-path.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';

const DB_OPT = { flags: '--db <path>', describe: 'path to loom.db (else --data-dir)' };

type WpRow = {
  id: string;
  screenKey: string | null;
  title: string;
  state: WpState;
  attempts: number;
  bestDiff: number | null;
};

export const wpListCommand = defineCommand({
  name: 'wp list',
  group: 'work',
  describe: 'List work packages for a run (latest run by default)',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  options: [
    DB_OPT,
    { flags: '--run <id>', describe: 'run id (default: latest)' },
    { flags: '--state <state>', describe: 'filter by work-package state' },
  ],
  examples: ['loom wp list --data-dir ./.loom-data', 'loom wp list --run run_x --json'],
  run(ctx, input) {
    const db = openDb(requireExistingDb(ctx, input.options.db));
    try {
      const store = new TaskStore(db);
      const runId = (input.options.run as string | undefined) ?? store.latestRun()?.id;
      if (!runId) throw notFoundError('run', 'latest', 'run `loom run` first');
      const filter = input.options.state ? { state: input.options.state as WpState } : undefined;
      const workPackages: WpRow[] = store.listWorkPackages(runId, filter).map((wp) => ({
        id: wp.id,
        screenKey: wp.screenKey,
        title: wp.title,
        state: wp.state,
        attempts: store.listAttempts(wp.id).length,
        bestDiff: store.bestEval(wp.id)?.visualPct ?? null,
      }));
      return { runId, workPackages };
    } finally {
      db.close();
    }
  },
  render(data, ctx) {
    const d = data as { runId: string; workPackages: WpRow[] };
    if (d.workPackages.length === 0) {
      ctx.sink.line(`run ${d.runId}: no work packages yet`);
      return;
    }
    ctx.sink.line(
      renderTable(
        d.workPackages.map((w) => ({
          id: w.id,
          screen: w.screenKey ?? '-',
          state: w.state,
          tries: String(w.attempts),
          diff: w.bestDiff === null ? '-' : `${w.bestDiff.toFixed(2)}%`,
        })),
        [
          { key: 'id', header: 'ID' },
          { key: 'screen', header: 'SCREEN' },
          { key: 'state', header: 'STATE' },
          { key: 'tries', header: 'TRIES', align: 'right' },
          { key: 'diff', header: 'BEST DIFF', align: 'right' },
        ],
      ),
    );
  },
});

type AttemptRow = {
  n: number;
  role: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  failureReason: string | null;
};

export const wpShowCommand = defineCommand({
  name: 'wp show',
  group: 'work',
  describe: 'Show one work package: state, attempts, and best eval',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  args: [{ name: 'id', describe: 'work package id', required: true }],
  options: [DB_OPT],
  examples: ['loom wp show wp_abc123 --data-dir ./.loom-data'],
  run(ctx, input) {
    const db = openDb(requireExistingDb(ctx, input.options.db));
    try {
      const store = new TaskStore(db);
      const id = input.args.id as string;
      const wp = store.getWorkPackage(id);
      if (!wp) throw notFoundError('work package', id);
      const attempts: AttemptRow[] = store.listAttempts(id).map((a) => ({
        n: a.n,
        role: a.role,
        status: a.status,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        failureReason: a.failureReason,
      }));
      const best = store.bestEval(id);
      return {
        id: wp.id,
        screenKey: wp.screenKey,
        title: wp.title,
        state: wp.state,
        attempts,
        bestEval: best ? { visualPct: best.visualPct, passed: best.passed } : null,
      };
    } finally {
      db.close();
    }
  },
  render(data, ctx) {
    const d = data as {
      id: string;
      screenKey: string | null;
      title: string;
      state: string;
      attempts: AttemptRow[];
      bestEval: { visualPct: number | null; passed: boolean } | null;
    };
    ctx.sink.line(`${d.id} — ${d.title} [${d.state}]`);
    ctx.sink.line(`screen: ${d.screenKey ?? '-'}`);
    if (d.bestEval) {
      const pct = d.bestEval.visualPct === null ? '-' : `${d.bestEval.visualPct.toFixed(2)}%`;
      ctx.sink.line(`best eval: ${d.bestEval.passed ? 'PASS' : 'FAIL'} (${pct})`);
    }
    ctx.sink.line('');
    if (d.attempts.length === 0) {
      ctx.sink.line('no attempts yet');
      return;
    }
    ctx.sink.line(
      renderTable(
        d.attempts.map((a) => ({
          n: String(a.n),
          role: a.role,
          status: a.status,
          tokens: `${a.inputTokens}+${a.outputTokens}`,
          reason: a.failureReason ?? '',
        })),
        [
          { key: 'n', header: '#', align: 'right' },
          { key: 'role', header: 'ROLE' },
          { key: 'status', header: 'STATUS' },
          { key: 'tokens', header: 'TOKENS', align: 'right' },
          { key: 'reason', header: 'REASON' },
        ],
      ),
    );
  },
});
