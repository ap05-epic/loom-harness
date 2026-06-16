import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { openDb, type Profile } from '@loom/core';
import { startMissionControl, type McpInfo } from '@loom/mission-control';
import { requireExistingDb } from '../../db-path.js';
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

/** Best-effort open of a URL in the OS default browser. */
function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    spawn(cmd, [url], {
      shell: process.platform === 'win32',
      detached: true,
      stdio: 'ignore',
    }).unref();
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
    const db = openDb(requireExistingDb(ctx, input.options.db));
    const port = input.options.port !== undefined ? Number(input.options.port) : undefined;
    // A profile enriches the inventory (skills dir + external MCP) but isn't required to watch.
    const profile = optionalProfile(ctx);
    const skillsDir =
      profile?.skills?.dir &&
      (isAbsolute(profile.skills.dir) ? profile.skills.dir : join(profile.dir, profile.skills.dir));
    const externalMcp: McpInfo[] | undefined = profile?.mcp?.servers.map((s) => ({
      name: s.name,
      description: [s.command, ...(s.args ?? [])].join(' '),
    }));
    const mc = await startMissionControl({
      db,
      port,
      project: profile?.project,
      skillsDir: skillsDir || undefined,
      externalMcp,
      digitHome: ctx.env.DIGIT_HOME ?? ctx.env.COPILOT_HOME,
    });
    ctx.sink.line(`Mission Control → ${mc.url}  (Ctrl-C to stop)`);
    if (input.options.open) openBrowser(mc.url);
    // Serve until interrupted, then shut down cleanly.
    await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
    await mc.stop();
    db.close();
    return { url: mc.url, port: mc.port };
  },
  render(data, ctx) {
    ctx.sink.line(`stopped Mission Control (${(data as { url: string }).url})`);
  },
});
