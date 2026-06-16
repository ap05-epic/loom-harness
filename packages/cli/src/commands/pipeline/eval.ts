import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserSession } from '@loom/browser';
import { evaluateVisual } from '@loom/evaluator';
import { networkError, usageError, EXIT } from '../../errors.js';
import { defineCommand } from '../../registry.js';

type EvalData = {
  passed: boolean;
  threshold: number;
  worst: { state: string; viewport: string; diffPercent: number };
  pairs: Array<{ state: string; viewport: string; diffPercent: number }>;
  out?: string;
};

export const evalCommand = defineCommand({
  name: 'eval',
  group: 'pipeline',
  describe: 'Visual parity eval of two URLs (legacy A vs rebuilt B)',
  exitCodes: ['USAGE', 'NETWORK', 'RUNTIME'],
  options: [
    { flags: '--a <url>', describe: 'baseline (legacy) URL' },
    { flags: '--b <url>', describe: 'rebuilt URL' },
    { flags: '--state <name>', describe: 'state label for the report (default: page)' },
    { flags: '--threshold <pct>', describe: 'max acceptable diff %% (default: 1)' },
    { flags: '--width <px>', describe: 'viewport width (default: 1280)' },
    { flags: '--height <px>', describe: 'viewport height (default: 1024)' },
    { flags: '--out <dir>', describe: 'write diff images + scorecard.json here' },
  ],
  examples: [
    'loom eval --a http://legacy/login --b http://new/login',
    'loom eval --a $A --b $B --threshold 1.5 --out ./eval-login --json',
  ],
  async run(ctx, input) {
    const o = input.options;
    const a = o.a as string | undefined;
    const b = o.b as string | undefined;
    if (!a || !b) throw usageError('both --a and --b URLs are required');
    const threshold = Number(o.threshold ?? 1);
    const state = (o.state as string | undefined) ?? 'page';
    const viewport = { width: Number(o.width ?? 1280), height: Number(o.height ?? 1024) };

    const session = new BrowserSession();
    let capA: Buffer;
    let capB: Buffer;
    try {
      await session.open();
      ctx.sink.info(`capturing A: ${a}`);
      capA = await session.capture({ url: a, viewport });
      ctx.sink.info(`capturing B: ${b}`);
      capB = await session.capture({ url: b, viewport });
    } catch (error) {
      throw networkError(
        error instanceof Error ? error.message : String(error),
        'check the URLs are reachable and a browser is installed (`loom doctor`)',
      );
    } finally {
      await session.close();
    }

    const result = evaluateVisual([{ state, viewport: 'desktop', a: capA, b: capB }], {
      threshold,
    });

    const out = o.out as string | undefined;
    if (out) {
      mkdirSync(out, { recursive: true });
      for (const pair of result.pairs) {
        writeFileSync(join(out, `${pair.state}.${pair.viewport}.diff.png`), pair.diffPng);
      }
      writeFileSync(
        join(out, 'scorecard.json'),
        JSON.stringify(
          { passed: result.verdict.passed, threshold, states: result.verdict.states },
          null,
          2,
        ),
      );
    }

    if (!result.verdict.passed) ctx.requestExit(EXIT.RUNTIME);

    return {
      passed: result.verdict.passed,
      threshold,
      worst: result.verdict.worst,
      pairs: result.pairs.map((p) => ({
        state: p.state,
        viewport: p.viewport,
        diffPercent: p.diffPercent,
      })),
      out,
    } satisfies EvalData;
  },
  render(data, ctx) {
    const d = data as EvalData;
    for (const p of d.pairs) {
      ctx.sink.line(`${p.state} (${p.viewport}): ${p.diffPercent.toFixed(3)}% diff`);
    }
    ctx.sink.line('');
    ctx.sink.line(
      `${d.passed ? 'PASS' : 'FAIL'} — worst ${d.worst.diffPercent.toFixed(3)}% vs threshold ${d.threshold}%`,
    );
    if (d.out) ctx.sink.line(`artifacts: ${d.out}`);
  },
});
