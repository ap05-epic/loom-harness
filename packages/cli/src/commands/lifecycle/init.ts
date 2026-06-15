import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
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

function configYaml(project: string, model: string): string {
  return [
    `project: ${project}`,
    `llm:`,
    `  driver: openai`,
    `  model: ${model}`,
    `  baseUrlEnv: LLM_BASE_URL`,
    `  apiKeyEnv: LLM_API_KEY`,
    ``,
  ].join('\n');
}

const ENV_TEMPLATE = [
  '# Direct OpenAI-compatible endpoint (base URL must include the version path, e.g. /openai/v1)',
  'LLM_BASE_URL=',
  'LLM_API_KEY=',
  '',
].join('\n');

export const initCommand = defineCommand({
  name: 'init',
  group: 'lifecycle',
  describe: 'Create a harness profile (harness.config.yaml + .env) in a data directory',
  exitCodes: ['CONFIG', 'USAGE'],
  options: [
    { flags: '--dir <path>', describe: 'target directory (defaults to --data-dir)' },
    { flags: '--project <name>', describe: 'project name' },
    { flags: '--model <id>', describe: 'default model id (default: gpt-5.4)' },
    { flags: '--force', describe: 'overwrite an existing harness.config.yaml' },
  ],
  examples: [
    'harness init --data-dir ~/harness-data/baa',
    'harness init --dir ./data --project demo --no-input',
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

    const configPath = join(dir, 'harness.config.yaml');
    if (existsSync(configPath) && !o.force) {
      throw usageError(`${configPath} already exists`, 'pass --force to overwrite');
    }

    let project = (o.project as string | undefined) ?? basename(dir);
    let model = (o.model as string | undefined) ?? 'gpt-5.4';
    if (ctx.mode.interactive) {
      if (!o.project) project = await input({ message: 'Project name:', default: project });
      if (!o.model) model = await input({ message: 'Default model:', default: model });
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, configYaml(project, model));
    const envPath = join(dir, '.env');
    const wroteEnv = !existsSync(envPath);
    if (wroteEnv) writeFileSync(envPath, ENV_TEMPLATE);

    return { dir, configPath, envPath, project, model, wroteEnv };
  },
  render(data, ctx) {
    const d = data as { configPath: string; envPath: string; wroteEnv: boolean };
    ctx.sink.line(`Wrote ${d.configPath}`);
    ctx.sink.line(
      d.wroteEnv
        ? `Wrote ${d.envPath} (fill in LLM_BASE_URL + LLM_API_KEY)`
        : `Kept existing ${d.envPath}`,
    );
    ctx.sink.line('Next: edit .env, then run `harness doctor`.');
  },
});
