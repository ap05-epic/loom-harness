import { existsSync, rmSync } from 'node:fs';
import { discoverLegacyWebapp, mapProject } from '@loom/cartographer';
import { runPipeline } from '@loom/conductor';
import { inboxLine, tool, type ChatSession, type ChatTool } from '@loom/chat';
import { MIGRATIONS, runMigrations, TaskStore } from '@loom/core';
import { resolvePipelineConfig, type ResolvedPipeline } from '../../pipeline-config.js';

/** Resolve the pipeline config, or a friendly message if the profile isn't wired for a run yet. */
function resolveCfg(session: ChatSession): { cfg?: ResolvedPipeline; problem?: string } {
  try {
    return { cfg: resolvePipelineConfig(session.profile, {}) };
  } catch (error) {
    const e = error as { message?: string; hint?: string };
    return { problem: `${e.message ?? String(error)}${e.hint ? ` (${e.hint})` : ''}` };
  }
}

/**
 * The profile-readiness probe for `show_profile` / `configure_project`. The CLI wires this onto the
 * {@link ChatSession} so `@loom/chat` can report "ready to run" without depending on the conductor or
 * the CLI's pipeline-config resolver. It reads the live `session.profile`, so it reflects a profile
 * that `configure_project` just rewrote.
 */
export function chatReadiness(session: ChatSession): () => { ready: boolean; problem?: string } {
  return () => {
    const { cfg, problem } = resolveCfg(session);
    return cfg ? { ready: true } : { ready: false, problem };
  };
}

/**
 * The pipeline-executing chat tools (map / run / resume). They live in the CLI — not in `@loom/chat`
 * — because they drive the conductor and cartographer, and a browser surface must NOT run a pipeline
 * inline (it triggers stages out of band instead). The CLI injects them as `extraTools`.
 */
export function buildPipelineTools(session: ChatSession): ChatTool[] {
  const { db } = session;
  return [
    tool(
      'map',
      'Map the legacy source into the CodeAtlas (the MAP stage). Returns the screens found.',
      { type: 'object', properties: {}, additionalProperties: false },
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
      { type: 'object', properties: {}, additionalProperties: false },
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
