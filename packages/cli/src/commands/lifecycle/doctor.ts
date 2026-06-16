import { BUILTIN_CHECKS, runChecks, type DoctorResult } from '../../doctor.js';
import { defineCommand } from '../../registry.js';
import { EXIT } from '../../errors.js';

type DoctorData = { checks: DoctorResult[]; passed: number; total: number };

export const doctorCommand = defineCommand({
  name: 'doctor',
  group: 'lifecycle',
  describe: 'Check this environment can run the harness',
  exitCodes: ['RUNTIME'],
  examples: ['loom doctor', 'loom doctor --json'],
  async run(ctx) {
    const checks = await runChecks(BUILTIN_CHECKS);
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
