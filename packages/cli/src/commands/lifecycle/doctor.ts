import { BUILTIN_CHECKS, dataDirCheck, runChecks, type DoctorResult } from '../../doctor.js';
import { defineCommand } from '../../registry.js';
import { EXIT } from '../../errors.js';

type DoctorData = { checks: DoctorResult[]; passed: number; total: number };

export const doctorCommand = defineCommand({
  name: 'doctor',
  group: 'lifecycle',
  describe: 'Check this environment can run Loom',
  exitCodes: ['RUNTIME'],
  examples: ['loom doctor', 'loom doctor --data-dir <dir> --json'],
  async run(ctx) {
    // When a data dir is known, also verify it lives outside any git clone.
    const dataDir =
      (ctx.flags.dataDir as string | undefined) ??
      ctx.env.LOOM_DATA_DIR ??
      ctx.env.HARNESS_DATA_DIR;
    const extra = dataDirCheck(dataDir);
    const checks = await runChecks(extra ? [...BUILTIN_CHECKS, extra] : BUILTIN_CHECKS);
    const passed = checks.filter((c) => c.ok).length;
    if (passed < checks.length) ctx.requestExit(EXIT.RUNTIME);
    return { checks, passed, total: checks.length } satisfies DoctorData;
  },
  render(data, ctx) {
    const d = data as DoctorData;
    for (const c of d.checks) {
      ctx.sink.line(`[${c.ok ? 'OK  ' : 'FAIL'}] ${c.name}: ${c.detail}`);
      if (!c.ok && c.hint) ctx.sink.line(`       hint: ${c.hint}`);
    }
    ctx.sink.line('');
    ctx.sink.line(`${d.passed}/${d.total} checks passed`);
  },
});
