import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { MIGRATIONS, openDb, ProfileStore, runMigrations, type Profile } from '@loom/core';
import { defaultWebDistDir, startMissionControl, type McpInfo } from '@loom/mission-control';
import { homeDataDir } from '../../workspace.js';
import { gatewayFromProfile } from '../../pipeline-config.js';
import { defineCommand } from '../../registry.js';
import type { CliContext } from '../../context.js';

/** Resolve the profile if one is configured; Mission Control runs fine without it. */
function optionalProfile(ctx: CliContext): Profile | undefined {
  try {
    return ctx.requireProfile();
  } catch {
    return undefined;
  }
}

/** Best-effort open of a URL in the OS default browser (a no-op on a headless host). */
function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], {
      shell: process.platform === 'win32',
      detached: true,
      stdio: 'ignore',
    });
    // A missing opener (e.g. no `xdg-open` on a headless pod) emits an ASYNC 'error' event that a
    // try/catch can't catch — handle it so it never crashes the server. The URL is printed anyway.
    child.on('error', () => {});
    child.unref();
  } catch {
    /* opening is best-effort */
  }
}

export const uiCommand = defineCommand({
  name: 'ui',
  group: 'observe',
  describe:
    'Launch the local Mission Control dashboard (read-only over loom.db; gate/question decisions write back)',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  options: [
    { flags: '--db <path>', describe: 'path to loom.db (else --data-dir)' },
    { flags: '--port <n>', describe: 'bind port (default: ephemeral)' },
    { flags: '--open', describe: 'open the dashboard in your browser' },
  ],
  examples: ['loom ui --data-dir ./.loom-data', 'loom ui --port 7777 --open'],
  async run(ctx, input) {
    const port = input.options.port !== undefined ? Number(input.options.port) : undefined;
    // A profile enriches the inventory (skills dir + external MCP) + enables chat/BAA, but isn't required.
    const profile = optionalProfile(ctx);
    // Open-or-create the db so `loom ui` (and bare `loom`) works on a fresh machine — it serves the
    // dashboard + the Setup wizard even before the first run. Resolve: --db, else the profile's data
    // dir, else the global home (~/.loom).
    const dbPath =
      typeof input.options.db === 'string' && input.options.db
        ? input.options.db
        : join(profile?.dataDir ?? homeDataDir(ctx.env), 'loom.db');
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = openDb(dbPath);
    runMigrations(db, MIGRATIONS);
    const skillsDir =
      profile?.skills?.dir &&
      (isAbsolute(profile.skills.dir) ? profile.skills.dir : join(profile.dir, profile.skills.dir));
    const externalMcp: McpInfo[] | undefined = profile?.mcp?.servers.map((s) => ({
      name: s.name,
      description: [s.command, ...(s.args ?? [])].join(' '),
    }));
    // The profile learning root (cross-project memory + skills) — opened once, shared by every chat
    // turn, fresh when you switch profiles. Bound by `profile:` in loom.config.yaml (default: project).
    const profileStore = profile
      ? new ProfileStore(homeDataDir(ctx.env), profile.profile ?? profile.project)
      : undefined;
    const mc = await startMissionControl({
      db,
      port,
      project: profile?.project,
      skillsDir: skillsDir || undefined,
      externalMcp,
      digitHome: ctx.env.DIGIT_HOME ?? ctx.env.COPILOT_HOME,
      // Lets the Live Crawl view fetch per-screen thumbnails from where `loom explore` saved them.
      exploreShotsDir: profile?.dataDir ? join(profile.dataDir, 'explore-shots') : undefined,
      // Serve the built React SPA when present; the server falls back to the vanilla dashboard.
      webDistDir: defaultWebDistDir(),
      // Enable the browser Generic Chat surface when a profile is configured — it drives the SAME
      // agent loop as `loom chat`. The file/exec tools are confined to the cwd `loom ui` ran in.
      chat: profile
        ? {
            gateway: gatewayFromProfile(profile),
            model: profile.llm.model,
            profile,
            root: ctx.cwd,
            version: ctx.version,
            profileStore,
            homeDir: homeDataDir(ctx.env),
          }
        : undefined,
      // Enable the BAA stage graph's stage triggers: each spawns a detached `loom stage` child so the
      // conductor (via the CLI) stays the single writer and the work survives a UI restart.
      baa: profile?.dataDir
        ? {
            spawnStage: (stage, runId) => {
              const args = [
                process.argv[1]!,
                'stage',
                '--name',
                stage,
                '--data-dir',
                profile.dataDir!,
              ];
              if (runId) args.push('--run', runId);
              const child = spawn(process.execPath, args, {
                cwd: ctx.cwd,
                detached: true,
                stdio: 'ignore',
                env: process.env,
              });
              child.on('error', () => {}); // a failed stage spawn must not crash the UI server
              child.unref();
              return { pid: child.pid };
            },
          }
        : undefined,
    });
    ctx.sink.line(`Mission Control → ${mc.url}  (Ctrl-C to stop)`);
    if (input.options.open) openBrowser(mc.url);
    // Serve until interrupted, then shut down cleanly.
    await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
    await mc.stop();
    profileStore?.close();
    db.close();
    return { url: mc.url, port: mc.port };
  },
  render(data, ctx) {
    ctx.sink.line(`stopped Mission Control (${(data as { url: string }).url})`);
  },
});
