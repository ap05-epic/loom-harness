import { existsSync, rmSync } from 'node:fs';
import type { LlmGateway, ToolDef } from '@loom/agents';
import { discoverLegacyWebapp, mapProject } from '@loom/cartographer';
import { runPipeline } from '@loom/conductor';
import {
  applyGateDecision,
  GateStore,
  loadProfile,
  MIGRATIONS,
  QuestionStore,
  runMigrations,
  saveProfile,
  TaskStore,
  type Profile,
  type ProfileConfig,
  type SqliteDatabase,
} from '@loom/core';
import type { ToolRisk } from '@loom/tools';
import { resolvePipelineConfig, type ResolvedPipeline } from '../../pipeline-config.js';

/** Everything the chat tools operate on — opened once, bound into each tool for the session. */
export type ChatSession = {
  db: SqliteDatabase;
  gateway: LlmGateway;
  profile: Profile;
  version: string;
};

/** A harness tool the agent can call, plus its risk (for the permission policy). */
export type ChatTool = { def: ToolDef; risk: ToolRisk };

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const;

function tool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  risk: ToolRisk,
  execute: (args: unknown) => Promise<string>,
): ChatTool {
  return { def: { name, description, parameters, execute }, risk };
}

/** Resolve the pipeline config, or a friendly message if the profile isn't wired for a run yet. */
function resolveCfg(session: ChatSession): { cfg?: ResolvedPipeline; problem?: string } {
  try {
    return { cfg: resolvePipelineConfig(session.profile, {}) };
  } catch (error) {
    const e = error as { message?: string; hint?: string };
    return { problem: `${e.message ?? String(error)}${e.hint ? ` (${e.hint})` : ''}` };
  }
}

function inboxLine(db: SqliteDatabase): string {
  const gates = new GateStore(db).list({ status: 'open' }).length;
  const questions = new QuestionStore(db).list({ status: 'open' }).length;
  return `${gates} gate(s) + ${questions} question(s) awaiting you`;
}

/**
 * Build the harness-driving toolset for one chat session. Read tools just query
 * the db; inbox + pipeline tools change state and are gated by the permission
 * policy (see chat-agent.ts). Pipeline tools resolve their config lazily, so the
 * chat still works on a minimal profile.
 */
export function buildChatTools(session: ChatSession): ChatTool[] {
  const { db } = session;

  return [
    tool(
      'status',
      'Show the current run: status/stage, screens by state, token spend, and the open inbox.',
      NO_ARGS,
      'read',
      async () => {
        const tasks = new TaskStore(db);
        const run = tasks.latestRun({ status: 'running' }) ?? tasks.latestRun();
        if (!run) return 'No runs yet — the pipeline has not been started (use map, then run).';
        const wps = tasks.listWorkPackages(run.id);
        const n = (s: string) => wps.filter((w) => w.state === s).length;
        const usage = tasks.usageRollup(run.id);
        return [
          `run ${run.id} — ${run.status}${run.stage ? `, stage ${run.stage}` : ''}`,
          `screens: ${wps.length} total (passed ${n('passed')}, shipped ${n('shipped')}, building ${n('building')}, blocked ${n('blocked')}, needs_human ${n('needs_human')})`,
          `tokens: ${usage.inputTokens + usage.outputTokens}`,
          `inbox: ${inboxLine(db)}`,
        ].join('\n');
      },
    ),

    tool(
      'list_gates',
      'List the gates awaiting your approval (plan/deviation/ship/skill), with their ids.',
      NO_ARGS,
      'read',
      async () => {
        const gates = new GateStore(db).list({ status: 'open' });
        if (!gates.length) return 'No open gates.';
        return gates.map((g) => `${g.id} — ${g.type} on ${g.scopeId}`).join('\n');
      },
    ),

    tool(
      'list_questions',
      "List the agent's open questions awaiting your answer, with their ids.",
      NO_ARGS,
      'read',
      async () => {
        const qs = new QuestionStore(db).list({ status: 'open' });
        if (!qs.length) return 'No open questions.';
        return qs.map((q) => `${q.id} — ${q.question}`).join('\n');
      },
    ),

    tool(
      'show_profile',
      'Show the current project profile and what (if anything) is missing before it can run.',
      NO_ARGS,
      'read',
      async () => {
        const p = session.profile;
        const lines = [
          `project: ${p.project}`,
          `model: ${p.llm.driver} / ${p.llm.model}`,
          `source.strutsConfig: ${p.source?.strutsConfig ?? '(not set)'}`,
          `app.baseUrl: ${p.app?.baseUrl ?? '(not set)'}`,
          `target.bRepo: ${p.target?.bRepo ?? 'b-repo (default)'}`,
          `eval.threshold: ${p.eval?.threshold ?? 1}%`,
        ];
        const { cfg, problem } = resolveCfg(session);
        lines.push(
          cfg ? 'status: ready to run (map, then run)' : `status: not runnable yet — ${problem}`,
        );
        return lines.join('\n');
      },
    ),

    tool(
      'configure_project',
      'Set up or update the project profile from what the user told you about their app. Collect ' +
        'the values in conversation first, then call this. Writes loom.config.yaml — never secrets ' +
        '(those go in .env).',
      {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'project name' },
          strutsConfig: {
            type: 'string',
            description: 'path to the legacy struts-config.xml (the MAP source)',
          },
          baseUrl: {
            type: 'string',
            description: 'URL of the running legacy app to match (the baseline)',
          },
          bRepo: {
            type: 'string',
            description: 'directory to write the rebuild into (default b-repo)',
          },
          threshold: { type: 'number', description: 'max visual diff %% to pass (default 1)' },
          storageStatePath: {
            type: 'string',
            description: 'saved SSO auth-state file, for login-gated apps',
          },
        },
        additionalProperties: false,
      },
      'expensive',
      async (args) => {
        const a = (args ?? {}) as {
          project?: string;
          strutsConfig?: string;
          baseUrl?: string;
          bRepo?: string;
          threshold?: number;
          storageStatePath?: string;
        };
        const p = session.profile;
        const baseUrl = a.baseUrl ?? p.app?.baseUrl;
        const storageStatePath = a.storageStatePath ?? p.app?.storageStatePath;
        const config: ProfileConfig = {
          project: a.project ?? p.project,
          llm: p.llm,
          source: a.strutsConfig ? { strutsConfig: a.strutsConfig } : p.source,
          app: baseUrl ? { baseUrl, ...(storageStatePath ? { storageStatePath } : {}) } : p.app,
          target: a.bRepo ? { bRepo: a.bRepo } : p.target,
          eval: a.threshold != null ? { ...(p.eval ?? {}), threshold: a.threshold } : p.eval,
          crawl: p.crawl,
          mcp: p.mcp,
          skills: p.skills,
        };
        let saved: string;
        try {
          saved = saveProfile(config, p.dir);
        } catch (error) {
          return `Could not save the profile — ${
            error instanceof Error ? error.message : String(error)
          }. Ask the user for the missing value.`;
        }
        // Reload so this session — and the next map/run — sees the update.
        session.profile = loadProfile(p.dir, p.dataDir ? { dataDir: p.dataDir } : {});
        const { cfg, problem } = resolveCfg(session);
        return cfg
          ? `Saved ${saved}. The project is ready — source + app are set. Offer to run \`map\`, then \`run\`.`
          : `Saved ${saved}. Still not runnable — ${problem}. Ask the user for the missing value.`;
      },
    ),

    tool(
      'approve_gate',
      'Approve an open gate by id (e.g. ship a passed screen). Optionally include a note.',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the gate id' },
          note: { type: 'string', description: 'optional decision note' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      'expensive',
      async (args) => {
        const { id, note } = args as { id: string; note?: string };
        const res = applyGateDecision(db, id, 'approved', note);
        return res
          ? `Approved gate ${id}.`
          : `No open gate with id "${id}" (unknown or already decided).`;
      },
    ),

    tool(
      'reject_gate',
      'Reject an open gate by id. Optionally include a note explaining why.',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the gate id' },
          note: { type: 'string', description: 'optional reason' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      'expensive',
      async (args) => {
        const { id, note } = args as { id: string; note?: string };
        const res = applyGateDecision(db, id, 'rejected', note);
        return res
          ? `Rejected gate ${id}.`
          : `No open gate with id "${id}" (unknown or already decided).`;
      },
    ),

    tool(
      'answer_question',
      "Answer an open agent question by id, unblocking its screen. Then run 'resume' to retry it.",
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the question id' },
          answer: { type: 'string', description: 'your answer' },
        },
        required: ['id', 'answer'],
        additionalProperties: false,
      },
      'expensive',
      async (args) => {
        const { id, answer } = args as { id: string; answer: string };
        const store = new QuestionStore(db);
        const q = store.get(id);
        if (!q || q.status !== 'open') return `No open question with id "${id}".`;
        store.answer(id, answer);
        return `Answered question ${id}. Use 'resume' to retry its screen.`;
      },
    ),

    tool(
      'map',
      'Map the legacy source into the CodeAtlas (the MAP stage). Returns the screens found.',
      NO_ARGS,
      'expensive',
      async () => {
        const { cfg, problem } = resolveCfg(session);
        if (!cfg) return `Can't map yet — ${problem}`;
        if (!existsSync(cfg.strutsConfigPath)) {
          return `struts-config not found at ${cfg.strutsConfigPath} — check source.strutsConfig.`;
        }
        for (const suffix of ['', '-wal', '-shm']) {
          const f = cfg.atlasPath + suffix;
          if (existsSync(f)) rmSync(f);
        }
        const discovered = discoverLegacyWebapp(cfg.strutsConfigPath);
        const atlas = mapProject({
          strutsConfigPath: cfg.strutsConfigPath,
          atlasPath: cfg.atlasPath,
          tilesDefsPath: discovered.tilesDefsPath,
          webXmlPath: discovered.webXmlPath,
          jsps: discovered.jsps,
        });
        try {
          const screens = atlas.screens().map((s) => s.key);
          return `Mapped ${screens.length} screen(s): ${screens.join(', ')} → ${cfg.atlasPath}`;
        } finally {
          atlas.close();
        }
      },
    ),

    tool(
      'run',
      'Run the rebuild pipeline (MAP→CRAWL→BUILD→EVAL→FIX). Optionally limit to specific screen keys, or enable unattended shift mode.',
      {
        type: 'object',
        properties: {
          screens: {
            type: 'array',
            items: { type: 'string' },
            description: 'optional screen keys to build (default: all)',
          },
          shift: { type: 'boolean', description: 'unattended shift mode with stop-the-line' },
        },
        additionalProperties: false,
      },
      'expensive',
      async (args) => {
        const { screens, shift } = args as { screens?: string[]; shift?: boolean };
        const { cfg, problem } = resolveCfg(session);
        if (!cfg) return `Can't run yet — ${problem}`;
        runMigrations(db, MIGRATIONS);
        const result = await runPipeline({
          db,
          gateway: session.gateway,
          model: cfg.model,
          project: cfg.project,
          strutsConfigPath: cfg.strutsConfigPath,
          atlasPath: cfg.atlasPath,
          legacyBaseUrl: cfg.legacyBaseUrl,
          bRepoRoot: cfg.bRepoRoot,
          baselineDir: cfg.baselineDir,
          screens: screens ?? cfg.screens,
          threshold: cfg.threshold,
          viewport: cfg.viewport,
          maxAttempts: cfg.maxAttempts,
          skillsDir: cfg.skillsDir,
          harnessVersion: session.version,
          shift: shift ? { stopAfterConsecutiveFailures: 3 } : undefined,
        });
        return (
          `Run ${result.runId}: ${result.passed} passed, ${result.failed} not passed, coverage ${result.coverage.coveragePct}%.` +
          (result.stopReason ? ` Stopped: ${result.stopReason}.` : '') +
          ` Inbox: ${inboxLine(db)}.`
        );
      },
    ),

    tool(
      'resume',
      'Resume the latest interrupted run, finishing its unfinished screens (after answering questions).',
      NO_ARGS,
      'expensive',
      async () => {
        const { cfg, problem } = resolveCfg(session);
        if (!cfg) return `Can't resume yet — ${problem}`;
        const runId = new TaskStore(db).latestRun({ status: 'running' })?.id;
        if (!runId) return 'No resumable run — start one with the run tool.';
        runMigrations(db, MIGRATIONS);
        const result = await runPipeline({
          db,
          gateway: session.gateway,
          model: cfg.model,
          project: cfg.project,
          strutsConfigPath: cfg.strutsConfigPath,
          atlasPath: cfg.atlasPath,
          legacyBaseUrl: cfg.legacyBaseUrl,
          bRepoRoot: cfg.bRepoRoot,
          baselineDir: cfg.baselineDir,
          threshold: cfg.threshold,
          viewport: cfg.viewport,
          skillsDir: cfg.skillsDir,
          harnessVersion: session.version,
          runId,
        });
        return (
          `Resumed run ${result.runId}: ${result.passed} passed, ${result.failed} not passed, coverage ${result.coverage.coveragePct}%.` +
          ` Inbox: ${inboxLine(db)}.`
        );
      },
    ),
  ];
}
