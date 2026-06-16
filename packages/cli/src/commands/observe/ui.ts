import { spawn } from 'node:child_process';
import { openDb } from '@loom/core';
import { startMissionControl } from '@loom/mission-control';
import { requireExistingDb } from '../../db-path.js';
import { defineCommand } from '../../registry.js';

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
    const mc = await startMissionControl({ db, port });
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
