import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GateStore, QuestionStore, TaskStore, openDb } from '@loom/core';
import type { CliContext } from '../../context.js';
import { describeProvider } from '../../pipeline-config.js';
import { defineCommand } from '../../registry.js';

/** The project facts `decideNext` reasons over — gathered by the command, pure to decide. */
export type NextState = {
  configured: boolean;
  providerReady: boolean;
  atlasExists: boolean;
  latestRun: { status: string; stage?: string } | null;
  openGates: number;
  openQuestions: number;
  blockedWps: number;
};

export type NextStep = { command: string; reason: string };

/**
 * Recommend the single next command from the project's state — the "what do I do
 * now?" guide a pod operator wants after `doctor` goes green. Pure + ordered:
 * setup → map → run → unblock the human inbox → monitor → report.
 */
export function decideNext(s: NextState): NextStep {
  if (!s.configured) {
    return {
      command: 'loom init --data-dir <dir>',
      reason: 'No profile yet — create one (in a data dir outside any git clone).',
    };
  }
  if (!s.providerReady) {
    return {
      command: 'loom models test',
      reason:
        'Set your model credentials in .env (LLM_BASE_URL …/openai/v1 + LLM_API_KEY), then verify the backend.',
    };
  }
  if (!s.atlasExists) {
    return { command: 'loom map', reason: 'Map the legacy source into the CodeAtlas first.' };
  }
  if (!s.latestRun) {
    return {
      command: 'loom run',
      reason: 'The atlas is ready — start the rebuild pipeline (MAP→CRAWL→BUILD→EVAL→FIX).',
    };
  }
  if (s.openGates > 0) {
    return { command: 'loom gates list', reason: `${s.openGates} gate(s) awaiting your approval.` };
  }
  if (s.openQuestions > 0) {
    return {
      command: 'loom questions list',
      reason: `${s.openQuestions} agent question(s) awaiting an answer.`,
    };
  }
  if (s.latestRun.status === 'running') {
    return { command: 'loom watch', reason: 'A run is in progress — watch it live.' };
  }
  if (s.blockedWps > 0) {
    return {
      command: 'loom wp list',
      reason: `${s.blockedWps} work package(s) blocked — inspect and retry.`,
    };
  }
  return {
    command: 'loom report',
    reason: 'All clear — view the modernization report for the latest run.',
  };
}

/** Prefer <dataDir>/loom.db; fall back to a legacy harness.db if that's the only one present. */
function loomDbIn(dataDir: string): string {
  const loomDb = join(dataDir, 'loom.db');
  const legacy = join(dataDir, 'harness.db');
  if (!existsSync(loomDb) && existsSync(legacy)) return legacy;
  return loomDb;
}

function gatherNextState(ctx: CliContext, optionDb: unknown): NextState {
  const empty = (over: Partial<NextState>): NextState => ({
    configured: false,
    providerReady: false,
    atlasExists: false,
    latestRun: null,
    openGates: 0,
    openQuestions: 0,
    blockedWps: 0,
    ...over,
  });

  let profile;
  try {
    profile = ctx.requireProfile();
  } catch {
    return empty({});
  }

  const provider = describeProvider(profile);
  const providerReady = !/NOT SET|disabled/i.test(provider.auth);
  const dataDir = profile.dataDir;
  const atlasExists = dataDir ? existsSync(join(dataDir, 'codeatlas.db')) : false;
  const base = empty({ configured: true, providerReady, atlasExists });

  const explicit = typeof optionDb === 'string' && optionDb ? optionDb : null;
  const dbPath = explicit ?? (dataDir ? loomDbIn(dataDir) : null);
  if (!dbPath || !existsSync(dbPath)) return base;

  try {
    const db = openDb(dbPath);
    try {
      const tasks = new TaskStore(db);
      const run = tasks.latestRun({ status: 'running' }) ?? tasks.latestRun();
      if (!run) return base;
      const blockedWps = tasks
        .listWorkPackages(run.id)
        .filter((w) => w.state === 'blocked' || w.state === 'needs_human').length;
      return {
        ...base,
        latestRun: { status: run.status, stage: run.stage ?? undefined },
        openGates: new GateStore(db).list({ status: 'open' }).length,
        openQuestions: new QuestionStore(db).list({ status: 'open' }).length,
        blockedWps,
      };
    } finally {
      db.close();
    }
  } catch {
    // A present-but-unmigrated / unreadable db just means "no runs yet".
    return base;
  }
}

export const nextCommand = defineCommand({
  name: 'next',
  group: 'lifecycle',
  describe: "Recommend the next command from this project's state",
  exitCodes: ['CONFIG'],
  options: [{ flags: '--db <path>', describe: 'path to loom.db (else --data-dir/profile)' }],
  examples: ['loom next', 'loom next --json'],
  run(ctx, input) {
    const state = gatherNextState(ctx, input.options.db);
    return { ...decideNext(state), state };
  },
  render(data, ctx) {
    const d = data as NextStep;
    ctx.sink.line(`next:  ${d.command}`);
    ctx.sink.line(`       ${d.reason}`);
  },
});
