import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS, openDb, runMigrations, TaskStore, type SqliteDatabase } from '@loom/core';
import {
  runBuildStage,
  runCrawlStage,
  runMapStage,
  runPipeline,
  runPlanStage,
  type BuildStrategy,
  type RunPipelineResult,
  type ShiftLimits,
} from '@loom/conductor';
import type { LlmGateway } from '@loom/agents';
import type { Profile } from '@loom/core';
import { EXIT, notFoundError, usageError } from '../../errors.js';
import { defineCommand } from '../../registry.js';
import {
  gatewayFromProfile,
  resolvePipelineConfig,
  type ResolvedPipeline,
} from '../../pipeline-config.js';
import { renderTable } from '../../ui/table.js';
import { stopFlagFor } from './stop.js';
import type { CliContext } from '../../context.js';

type RunData = {
  runId: string;
  passed: number;
  failed: number;
  coveragePct: number;
  notBuilt: string[];
  stopReason: string | null;
  screens: Array<{
    screenKey: string;
    state: string;
    diffPercent: number | null;
    attempts: number;
  }>;
};

const SCREENS_OPT = {
  flags: '--screens <list>',
  describe: 'comma-separated screen keys (default: all)',
};
const MODEL_OPT = { flags: '--model <id>', describe: 'override the builder model' };
const THRESHOLD_OPT = { flags: '--threshold <pct>', describe: 'max acceptable visual diff %%' };
const MAX_ATTEMPTS_OPT = {
  flags: '--max-attempts <n>',
  describe: 'build attempts before a screen blocks',
};
const SHIFT_OPT = {
  flags: '--shift',
  describe: 'unattended shift run — enable run-level safeguards (stop-the-line, budgets)',
};
const BUDGET_TOKENS_OPT = {
  flags: '--budget-tokens <n>',
  describe: 'stop the run after this many cumulative tokens',
};
const HOURS_OPT = { flags: '--hours <h>', describe: 'wall-clock budget in hours' };
const STOP_AFTER_OPT = {
  flags: '--stop-after-failures <n>',
  describe: 'stop after N consecutive screen failures (default 3 with --shift)',
};
const BUDGET_PER_SCREEN_OPT = {
  flags: '--budget-tokens-per-screen <n>',
  describe: 'per-screen token budget — block a screen once it spends this many',
};
const REFLECT_OPT = {
  flags: '--reflect',
  describe: 'after a screen passes, draft reusable skills + facts (self-improvement loop)',
};
const MAX_PARALLEL_OPT = {
  flags: '--max-parallel <n>',
  describe: 'build up to N independent screens concurrently (default 1)',
};
const SKILL_PROMOTE_AFTER_OPT = {
  flags: '--skill-promote-after <n>',
  describe:
    'successful reuses before a proven generated skill auto-promotes to bundled (default 3)',
};

/** Build the run-level shift safeguards from flags (only when something is set). */
function shiftFrom(opts: Record<string, unknown>): ShiftLimits | undefined {
  const enabled =
    Boolean(opts.shift) ||
    opts.budgetTokens !== undefined ||
    opts.hours !== undefined ||
    opts.stopAfterFailures !== undefined ||
    opts.budgetTokensPerScreen !== undefined;
  if (!enabled) return undefined;
  return {
    maxTokens: opts.budgetTokens !== undefined ? Number(opts.budgetTokens) : undefined,
    maxWallClockMs: opts.hours !== undefined ? Number(opts.hours) * 3_600_000 : undefined,
    stopAfterConsecutiveFailures:
      opts.stopAfterFailures !== undefined
        ? Number(opts.stopAfterFailures)
        : opts.shift
          ? 3
          : undefined,
    maxTokensPerWp:
      opts.budgetTokensPerScreen !== undefined ? Number(opts.budgetTokensPerScreen) : undefined,
  };
}

function overrides(opts: Record<string, unknown>) {
  const screens = typeof opts.screens === 'string' ? opts.screens : undefined;
  return {
    model: opts.model as string | undefined,
    threshold: opts.threshold !== undefined ? Number(opts.threshold) : undefined,
    maxAttempts: opts.maxAttempts !== undefined ? Number(opts.maxAttempts) : undefined,
    screens: screens
      ? screens
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  };
}

/** Open + migrate loom.db at the resolved path (creating parent dirs). */
function openHarnessDb(cfg: ResolvedPipeline): SqliteDatabase {
  mkdirSync(dirname(cfg.dbPath), { recursive: true });
  const db = openDb(cfg.dbPath);
  runMigrations(db, MIGRATIONS);
  return db;
}

/** OpenAI-only: always our own agent loop (the copilot build strategy is disabled). */
function buildStrategyFor(_profile: Profile): BuildStrategy | undefined {
  return undefined;
}

function pipelineArgs(
  cfg: ResolvedPipeline,
  db: SqliteDatabase,
  gateway: LlmGateway,
  version: string,
  build: BuildStrategy | undefined,
  shift: ShiftLimits | undefined,
  reflectOnPass: boolean,
  maxParallel: number | undefined,
  skillPromoteAfter: number | undefined,
) {
  return {
    db,
    gateway,
    build,
    shift,
    reflectOnPass,
    maxParallel,
    skillPromoteAfter,
    model: cfg.model,
    project: cfg.project,
    strutsConfigPath: cfg.strutsConfigPath,
    atlasPath: cfg.atlasPath,
    legacyBaseUrl: cfg.legacyBaseUrl,
    bRepoRoot: cfg.bRepoRoot,
    baselineDir: cfg.baselineDir,
    screens: cfg.screens,
    threshold: cfg.threshold,
    viewport: cfg.viewport,
    maxAttempts: cfg.maxAttempts,
    skillsDir: cfg.skillsDir,
    harnessVersion: version,
  };
}

function toRunData(result: RunPipelineResult): RunData {
  return {
    runId: result.runId,
    passed: result.passed,
    failed: result.failed,
    coveragePct: result.coverage.coveragePct,
    notBuilt: result.coverage.notBuilt,
    stopReason: result.stopReason,
    screens: result.screens.map((s) => ({
      screenKey: s.screenKey,
      state: s.state,
      diffPercent: s.diffPercent,
      attempts: s.attempts,
    })),
  };
}

function renderRun(data: unknown, ctx: CliContext): void {
  const d = data as RunData;
  ctx.sink.line(
    renderTable(
      d.screens.map((s) => ({
        screen: s.screenKey,
        state: s.state,
        diff: s.diffPercent === null ? '-' : `${s.diffPercent.toFixed(2)}%`,
        attempts: String(s.attempts),
      })),
      [
        { key: 'screen', header: 'SCREEN' },
        { key: 'state', header: 'STATE' },
        { key: 'diff', header: 'BEST DIFF', align: 'right' },
        { key: 'attempts', header: 'TRIES', align: 'right' },
      ],
    ),
  );
  ctx.sink.line('');
  if (d.stopReason) {
    ctx.sink.line(`SHIFT STOPPED: ${d.stopReason} — the run halted before finishing its scope.`);
  }
  ctx.sink.line(
    `run ${d.runId}: ${d.passed} passed, ${d.failed} not passed — coverage ${d.coveragePct}%${
      d.notBuilt.length ? ` (not built: ${d.notBuilt.join(', ')})` : ''
    }`,
  );
}

export const runCommand = defineCommand({
  name: 'run',
  group: 'pipeline',
  describe: 'Run the rebuild pipeline (MAP → CRAWL → BUILD → EVAL → FIX) over the legacy app',
  exitCodes: ['CONFIG', 'NETWORK', 'BLOCKED', 'RUNTIME'],
  options: [
    SCREENS_OPT,
    MODEL_OPT,
    THRESHOLD_OPT,
    MAX_ATTEMPTS_OPT,
    SHIFT_OPT,
    BUDGET_TOKENS_OPT,
    HOURS_OPT,
    STOP_AFTER_OPT,
    BUDGET_PER_SCREEN_OPT,
    REFLECT_OPT,
    MAX_PARALLEL_OPT,
    SKILL_PROMOTE_AFTER_OPT,
  ],
  examples: ['loom run', 'loom run --max-parallel 4 --shift --budget-tokens 2000000 --json'],
  async run(ctx, input) {
    const profile = ctx.requireProfile();
    const cfg = resolvePipelineConfig(profile, overrides(input.options));
    const gateway = gatewayFromProfile(profile);
    const db = openHarnessDb(cfg);
    const stopFlag = stopFlagFor({ db: cfg.dbPath })!;
    rmSync(stopFlag, { force: true }); // clear any stale stop request before starting
    try {
      const result = await runPipeline({
        ...pipelineArgs(
          cfg,
          db,
          gateway,
          ctx.version,
          buildStrategyFor(profile),
          shiftFrom(input.options),
          Boolean(input.options.reflect),
          input.options.maxParallel !== undefined ? Number(input.options.maxParallel) : undefined,
          input.options.skillPromoteAfter !== undefined
            ? Number(input.options.skillPromoteAfter)
            : undefined,
        ),
        shouldStop: () => existsSync(stopFlag),
        // Optional, env-gated: stream spans to an OTLP collector / ping a webhook if configured.
        otlpEndpoint: ctx.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        webhookUrl: ctx.env.LOOM_WEBHOOK_URL ?? ctx.env.HARNESS_WEBHOOK_URL,
      });
      if (result.failed > 0) ctx.requestExit(EXIT.BLOCKED);
      return toRunData(result);
    } finally {
      db.close();
    }
  },
  render: renderRun,
});

const RUN_ID_OPT = {
  flags: '--run <id>',
  describe: 'operate within a specific run id (default: latest running)',
};

export const planCommand = defineCommand({
  name: 'plan',
  group: 'pipeline',
  describe: 'Plan a run — create one work package per target screen (the PLAN stage), then stop',
  exitCodes: ['CONFIG', 'NETWORK', 'RUNTIME'],
  options: [SCREENS_OPT, MODEL_OPT, RUN_ID_OPT],
  examples: ['loom plan', 'loom plan --screens login,list'],
  async run(ctx, input) {
    const profile = ctx.requireProfile();
    const cfg = resolvePipelineConfig(profile, overrides(input.options));
    const gateway = gatewayFromProfile(profile);
    const db = openHarnessDb(cfg);
    try {
      const store = new TaskStore(db);
      const runId =
        (input.options.run as string | undefined) ?? store.latestRun({ status: 'running' })?.id;
      const args = pipelineArgs(
        cfg,
        db,
        gateway,
        ctx.version,
        buildStrategyFor(profile),
        undefined,
        false,
        undefined,
        undefined,
      );
      const result = await runPlanStage(runId ? { ...args, runId } : args);
      return toRunData(result);
    } finally {
      db.close();
    }
  },
  render: renderRun,
});

export const buildCommand = defineCommand({
  name: 'build',
  group: 'pipeline',
  describe:
    'Run the BUILD stage (BUILD → EVAL → FIX) over the planned screens, then finish the run',
  exitCodes: ['CONFIG', 'NETWORK', 'BLOCKED', 'NOT_FOUND', 'RUNTIME'],
  options: [
    SCREENS_OPT,
    MODEL_OPT,
    THRESHOLD_OPT,
    MAX_ATTEMPTS_OPT,
    SHIFT_OPT,
    BUDGET_TOKENS_OPT,
    HOURS_OPT,
    STOP_AFTER_OPT,
    BUDGET_PER_SCREEN_OPT,
    REFLECT_OPT,
    MAX_PARALLEL_OPT,
    SKILL_PROMOTE_AFTER_OPT,
    RUN_ID_OPT,
  ],
  examples: ['loom build', 'loom build --run run_abc123 --shift'],
  async run(ctx, input) {
    const profile = ctx.requireProfile();
    const cfg = resolvePipelineConfig(profile, overrides(input.options));
    const gateway = gatewayFromProfile(profile);
    const db = openHarnessDb(cfg);
    const stopFlag = stopFlagFor({ db: cfg.dbPath })!;
    rmSync(stopFlag, { force: true }); // clear any stale stop request before building
    try {
      const store = new TaskStore(db);
      const runId =
        (input.options.run as string | undefined) ?? store.latestRun({ status: 'running' })?.id;
      if (!runId) {
        throw notFoundError(
          'run to build',
          'latest',
          'plan one with `loom plan` (or use `loom run`)',
        );
      }
      const result = await runBuildStage({
        ...pipelineArgs(
          cfg,
          db,
          gateway,
          ctx.version,
          buildStrategyFor(profile),
          shiftFrom(input.options),
          Boolean(input.options.reflect),
          input.options.maxParallel !== undefined ? Number(input.options.maxParallel) : undefined,
          input.options.skillPromoteAfter !== undefined
            ? Number(input.options.skillPromoteAfter)
            : undefined,
        ),
        runId,
        shouldStop: () => existsSync(stopFlag),
        otlpEndpoint: ctx.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        webhookUrl: ctx.env.LOOM_WEBHOOK_URL ?? ctx.env.HARNESS_WEBHOOK_URL,
      });
      if (result.failed > 0) ctx.requestExit(EXIT.BLOCKED);
      return toRunData(result);
    } finally {
      db.close();
    }
  },
  render: renderRun,
});

export const stageCommand = defineCommand({
  name: 'stage',
  group: 'pipeline',
  describe:
    'Run a single pipeline stage (map | plan | crawl | build) against a run — the BAA stage-graph seam',
  exitCodes: ['CONFIG', 'NETWORK', 'BLOCKED', 'USAGE', 'RUNTIME'],
  options: [
    { flags: '--name <stage>', describe: 'which stage: map | plan | crawl | build' },
    RUN_ID_OPT,
    SCREENS_OPT,
    MODEL_OPT,
    THRESHOLD_OPT,
    MAX_ATTEMPTS_OPT,
    SHIFT_OPT,
    BUDGET_TOKENS_OPT,
    HOURS_OPT,
    STOP_AFTER_OPT,
    BUDGET_PER_SCREEN_OPT,
    REFLECT_OPT,
    MAX_PARALLEL_OPT,
  ],
  examples: ['loom stage --name map', 'loom stage --name build --run run_abc123'],
  async run(ctx, input) {
    const name = String(input.options.name ?? '');
    if (!['map', 'plan', 'crawl', 'build'].includes(name)) {
      throw usageError(`unknown stage "${name}"`, 'choose one of: map, plan, crawl, build');
    }
    const profile = ctx.requireProfile();
    const cfg = resolvePipelineConfig(profile, overrides(input.options));
    const gateway = gatewayFromProfile(profile);
    const db = openHarnessDb(cfg);
    const stopFlag = stopFlagFor({ db: cfg.dbPath })!;
    rmSync(stopFlag, { force: true });
    try {
      const store = new TaskStore(db);
      const runId =
        (input.options.run as string | undefined) ?? store.latestRun({ status: 'running' })?.id;
      const base = pipelineArgs(
        cfg,
        db,
        gateway,
        ctx.version,
        buildStrategyFor(profile),
        shiftFrom(input.options),
        Boolean(input.options.reflect),
        input.options.maxParallel !== undefined ? Number(input.options.maxParallel) : undefined,
        undefined,
      );
      const opts = {
        ...base,
        ...(runId ? { runId } : {}),
        shouldStop: () => existsSync(stopFlag),
        otlpEndpoint: ctx.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        webhookUrl: ctx.env.LOOM_WEBHOOK_URL ?? ctx.env.HARNESS_WEBHOOK_URL,
      };
      const result =
        name === 'map'
          ? await runMapStage(opts)
          : name === 'plan'
            ? await runPlanStage(opts)
            : name === 'crawl'
              ? await runCrawlStage(opts)
              : await runBuildStage(opts);
      if (result.failed > 0) ctx.requestExit(EXIT.BLOCKED);
      return toRunData(result);
    } finally {
      db.close();
    }
  },
  render: renderRun,
});

export const resumeCommand = defineCommand({
  name: 'resume',
  group: 'pipeline',
  describe: 'Resume the latest interrupted run, finishing its unfinished screens',
  exitCodes: ['CONFIG', 'NETWORK', 'BLOCKED', 'NOT_FOUND', 'RUNTIME'],
  options: [
    { flags: '--run <id>', describe: 'resume a specific run id (default: latest running)' },
  ],
  examples: ['loom resume', 'loom resume --run run_abc123 --json'],
  async run(ctx, input) {
    const profile = ctx.requireProfile();
    const cfg = resolvePipelineConfig(profile, overrides(input.options));
    const gateway = gatewayFromProfile(profile);
    const db = openHarnessDb(cfg);
    const stopFlag = stopFlagFor({ db: cfg.dbPath })!;
    rmSync(stopFlag, { force: true }); // clear any stale stop request before resuming
    try {
      const store = new TaskStore(db);
      const runId =
        (input.options.run as string | undefined) ?? store.latestRun({ status: 'running' })?.id;
      if (!runId) {
        throw notFoundError('resumable run', 'latest', 'start one with `loom run`');
      }
      const result = await runPipeline({
        ...pipelineArgs(
          cfg,
          db,
          gateway,
          ctx.version,
          buildStrategyFor(profile),
          undefined,
          false,
          undefined,
          undefined,
        ),
        runId,
        shouldStop: () => existsSync(stopFlag),
      });
      if (result.failed > 0) ctx.requestExit(EXIT.BLOCKED);
      return toRunData(result);
    } finally {
      db.close();
    }
  },
  render: renderRun,
});
