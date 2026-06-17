import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { input } from '@inquirer/prompts';
import { configError, usageError } from '../../errors.js';
import { defineCommand } from '../../registry.js';
import { homeDataDir } from '../../workspace.js';

function insideGitTree(startDir: string): boolean {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, '.git'))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

type Driver = 'openai' | 'anthropic';

function configYaml(project: string, model: string, driver: Driver): string {
  return (
    [
      `project: ${project}`,
      `llm:`,
      `  driver: ${driver}`,
      `  model: ${model}`,
      `  baseUrlEnv: LLM_BASE_URL`,
      `  apiKeyEnv: LLM_API_KEY`,
    ].join('\n') + '\n'
  );
}

const ENV_KEY = [
  '# Direct OpenAI/Azure endpoint (base URL must include the version path, e.g. /openai/v1)',
  'LLM_BASE_URL=',
  'LLM_API_KEY=',
  '',
].join('\n');

const DRIVERS: readonly Driver[] = ['openai', 'anthropic'];

export const initCommand = defineCommand({
  name: 'init',
  group: 'lifecycle',
  describe: 'Create a Loom profile (loom.config.yaml + .env) in a data directory',
  exitCodes: ['CONFIG', 'USAGE'],
  options: [
    { flags: '--dir <path>', describe: 'target directory (defaults to --data-dir)' },
    { flags: '--project <name>', describe: 'project name' },
    { flags: '--model <id>', describe: 'default model id (default: gpt-5.4)' },
    {
      flags: '--driver <driver>',
      describe: 'openai | anthropic (default: openai)',
    },
    { flags: '--force', describe: 'overwrite an existing loom.config.yaml' },
  ],
  examples: [
    'loom init --data-dir ~/harness-data/example',
    'loom init --dir ./data --project demo --no-input',
  ],
  async run(ctx, input_) {
    const o = input_.options;
    let dir = (o.dir as string | undefined) ?? ctx.flags.dataDir;
    if (!dir) {
      // Default to the global home (~/.loom) so `loom init` needs no flags; interactive users override.
      const home = homeDataDir(ctx.env);
      dir = ctx.mode.interactive
        ? await input({ message: 'Data directory:', default: home })
        : home;
    }
    dir = resolve(dir);

    if (insideGitTree(dir)) {
      throw configError(
        `${dir} is inside a git working tree`,
        'project data must live outside any clone — choose a directory not under a repo',
      );
    }

    const configPath = join(dir, 'loom.config.yaml');
    if (existsSync(configPath) && !o.force) {
      throw usageError(`${configPath} already exists`, 'pass --force to overwrite');
    }

    let project = (o.project as string | undefined) ?? basename(dir);
    let model = (o.model as string | undefined) ?? 'gpt-5.4';
    if (ctx.mode.interactive) {
      if (!o.project) project = await input({ message: 'Project name:', default: project });
      if (!o.model) model = await input({ message: 'Default model:', default: model });
    }

    // Driver: explicit flag wins; otherwise default to the OpenAI/Azure key path
    // (Loom is OpenAI-only — the copilot driver is disabled).
    let driver = o.driver as Driver | undefined;
    if (driver && !DRIVERS.includes(driver)) {
      throw usageError(`unknown driver "${driver}"`, `choose one of: ${DRIVERS.join(', ')}`);
    }
    let autoDetected = false;
    if (!driver) {
      driver = 'openai';
      autoDetected = true;
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, configYaml(project, model, driver));
    const envPath = join(dir, '.env');
    const wroteEnv = !existsSync(envPath);
    if (wroteEnv) writeFileSync(envPath, ENV_KEY);

    return { dir, configPath, envPath, project, model, driver, autoDetected, wroteEnv };
  },
  render(data, ctx) {
    const d = data as {
      configPath: string;
      envPath: string;
      driver: Driver;
      autoDetected: boolean;
      wroteEnv: boolean;
    };
    ctx.sink.line(`Wrote ${d.configPath}`);
    ctx.sink.line(
      `provider: ${d.driver}${d.autoDetected ? ' (default)' : ''} — direct OpenAI/Azure key (BYOK)`,
    );
    ctx.sink.line(
      d.wroteEnv
        ? `Wrote ${d.envPath} (fill in LLM_BASE_URL + LLM_API_KEY)`
        : `Kept existing ${d.envPath}`,
    );
    ctx.sink.line('Next: edit .env, then run `loom doctor`.');
  },
});
