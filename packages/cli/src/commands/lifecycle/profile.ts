import { defineCommand } from '../../registry.js';

export const profileShowCommand = defineCommand({
  name: 'profile show',
  group: 'lifecycle',
  describe: 'Show the resolved profile (secrets redacted)',
  exitCodes: ['CONFIG'],
  run(ctx) {
    const p = ctx.requireProfile();
    return {
      project: p.project,
      dir: p.dir,
      dataDir: p.dataDir ?? null,
      llm: {
        driver: p.llm.driver,
        model: p.llm.model,
        baseUrlEnv: p.llm.baseUrlEnv ?? null,
        apiKeyEnv: p.llm.apiKeyEnv ?? null,
        modelProfile: p.llm.modelProfile ?? null,
      },
    };
  },
  render(data, ctx) {
    const d = data as {
      project: string;
      dir: string;
      dataDir: string | null;
      llm: { driver: string; model: string };
    };
    ctx.sink.line(`project:  ${d.project}`);
    ctx.sink.line(`dir:      ${d.dir}`);
    ctx.sink.line(`dataDir:  ${d.dataDir ?? '(unset)'}`);
    ctx.sink.line(`llm:      ${d.llm.driver} / ${d.llm.model}`);
  },
});

export const profileValidateCommand = defineCommand({
  name: 'profile validate',
  group: 'lifecycle',
  describe: 'Validate the profile config (no side effects)',
  exitCodes: ['CONFIG'],
  run(ctx) {
    const p = ctx.requireProfile();
    return { ok: true, project: p.project };
  },
  render(data, ctx) {
    ctx.sink.line(`OK — profile "${(data as { project: string }).project}" is valid`);
  },
});
