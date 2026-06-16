import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { detectCopilot } from '@loom/agents';
import { input } from '@inquirer/prompts';
import { configError, usageError } from '../../errors.js';
import { defineCommand } from '../../registry.js';

function insideGitTree(startDir: string): boolean {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, '.git'))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

type Driver = 'copilot' | 'openai' | 'anthropic';

function configYaml(project: string, model: string, driver: Driver): string {
  const lines = [`project: ${project}`, `llm:`, `  driver: ${driver}`, `  model: ${model}`];
  if (driver !== 'copilot') {
    // copilot needs no key/URL — auth comes from the `copilot login` session.
    lines.push(`  baseUrlEnv: LLM_BASE_URL`, `  apiKeyEnv: LLM_API_KEY`);
  }
  lines.push('');
  return lines.join('\n');
}

const ENV_COPILOT = [
  '# Provider: GitHub Copilot login — NO key needed (auth via `copilot login` / `dc login`).',
  '# To switch to a direct BYOK key instead, set llm.driver: openai and fill these:',
  '# LLM_BASE_URL=',
  '# LLM_API_KEY=',
  '',
].join('\n');

const ENV_KEY = [
  '# Direct OpenAI-compatible endpoint (base URL must include the version path, e.g. /openai/v1)',
  'LLM_BASE_URL=',
  'LLM_API_KEY=',
  '',
].join('\n');

const DRIVERS: readonly Driver[] = ['copilot', 'openai', 'anthropic'];

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
      describe: 'copilot | openai | anthropic (default: auto — copilot if its CLI is present)',
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
    if (!dir && ctx.mode.interactive) {
      dir = await input({ message: 'Data directory (outside any git repo):' });
    }
    if (!dir) throw usageError('no target directory', 'pass --data-dir <path> or --dir <path>');
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

    // Driver: explicit flag wins; otherwise default to GitHub Copilot if its CLI
    // is present (the common case — a Copilot login, no key), else openai.
    let driver = o.driver as Driver | undefined;
    if (driver && !DRIVERS.includes(driver)) {
      throw usageError(`unknown driver "${driver}"`, `choose one of: ${DRIVERS.join(', ')}`);
    }
    let autoDetected = false;
    if (!driver) {
      const copilot = await detectCopilot({ probeAuth: false });
      driver = copilot.installed ? 'copilot' : 'openai';
      autoDetected = true;
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, configYaml(project, model, driver));
    const envPath = join(dir, '.env');
    const wroteEnv = !existsSync(envPath);
    if (wroteEnv) writeFileSync(envPath, driver === 'copilot' ? ENV_COPILOT : ENV_KEY);

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
      `provider: ${d.driver}${d.autoDetected ? ' (auto-detected)' : ''}` +
        (d.driver === 'copilot'
          ? ' — GitHub Copilot login, no key needed'
          : ' — direct key (BYOK)'),
    );
    if (d.driver === 'copilot') {
      ctx.sink.line(
        d.wroteEnv ? `Wrote ${d.envPath} (no key required)` : `Kept existing ${d.envPath}`,
      );
      ctx.sink.line('Next: ensure `copilot login` is done, then run `loom doctor`.');
    } else {
      ctx.sink.line(
        d.wroteEnv
          ? `Wrote ${d.envPath} (fill in LLM_BASE_URL + LLM_API_KEY)`
          : `Kept existing ${d.envPath}`,
      );
      ctx.sink.line('Next: edit .env, then run `loom doctor`.');
    }
  },
});
