import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { usageError } from '../../errors.js';
import { defineCommand } from '../../registry.js';

/** Where `loom run`/`resume` look for a cooperative stop request: `<dataDir>/loom.stop`. */
export function stopFlagFor(opts: { db?: string; dataDir?: string }): string | null {
  if (opts.db) return join(dirname(opts.db), 'loom.stop');
  if (opts.dataDir) return join(opts.dataDir, 'loom.stop');
  return null;
}

export const stopCommand = defineCommand({
  name: 'stop',
  group: 'pipeline',
  describe: 'Ask the active run to stop at its next safe checkpoint (resumable)',
  exitCodes: ['CONFIG', 'USAGE'],
  options: [{ flags: '--db <path>', describe: 'path to loom.db (else --data-dir/profile)' }],
  examples: ['loom stop', 'loom stop --data-dir ./.loom-data'],
  run(ctx, input) {
    const explicitDb = input.options.db as string | undefined;
    let flag = stopFlagFor({ db: explicitDb, dataDir: ctx.flags.dataDir });
    if (!flag) {
      const p = ctx.requireProfile();
      if (!p.dataDir) throw usageError('no data dir resolved', 'pass --db or --data-dir');
      flag = join(p.dataDir, 'loom.stop');
    }
    writeFileSync(flag, `stop requested ${new Date().toISOString()}\n`);
    return { stopFlag: flag };
  },
  render(data, ctx) {
    ctx.sink.line('stop requested — the active run will halt at its next safe checkpoint.');
    ctx.sink.line('resume later with `loom resume`. (Ctrl-C stops a foreground run immediately.)');
    ctx.sink.line(`flag: ${(data as { stopFlag: string }).stopFlag}`);
  },
});
