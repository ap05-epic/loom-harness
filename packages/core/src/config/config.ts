import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const modelProfileSchema = z.object({
  contextWindow: z.number().int().positive().optional(),
  maxOutput: z.number().int().positive().optional(),
  vision: z.boolean().optional(),
});

const llmSchema = z.object({
  driver: z.enum(['openai', 'copilot', 'anthropic']),
  model: z.string().min(1),
  baseUrlEnv: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  modelProfile: modelProfileSchema.optional(),
});

const profileSchema = z.object({
  project: z.string().min(1),
  llm: llmSchema,
});

export type LlmConfig = z.infer<typeof llmSchema>;
export type ModelProfileOverrides = z.infer<typeof modelProfileSchema>;

export type Profile = z.infer<typeof profileSchema> & {
  /** Profile directory (where harness.config.yaml lives). */
  dir: string;
  /** Resolved data directory, if provided. */
  dataDir?: string;
  /** Merged environment: .env file values overlaid by the real environment. */
  env: Record<string, string>;
};

export type LoadProfileOptions = {
  /** Environment to overlay on .env values (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Data directory the harness will write to; refused if inside a git tree. */
  dataDir?: string;
};

/** Parse a minimal KEY=VALUE .env format: comments, blank lines, quoted values. */
export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function insideGitTree(startDir: string): boolean {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, '.git'))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function loadProfile(dir: string, options: LoadProfileOptions = {}): Profile {
  const configPath = join(dir, 'harness.config.yaml');
  if (!existsSync(configPath)) {
    throw new Error(`No harness.config.yaml found in ${dir}`);
  }

  const raw: unknown = parseYaml(readFileSync(configPath, 'utf8'));
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid harness.config.yaml: ${issues}`);
  }

  const dotEnvPath = join(dir, '.env');
  const dotEnv = existsSync(dotEnvPath) ? parseDotEnv(readFileSync(dotEnvPath, 'utf8')) : {};
  const realEnv = options.env ?? process.env;
  const env: Record<string, string> = { ...dotEnv };
  for (const [key, value] of Object.entries(realEnv)) {
    if (value !== undefined) env[key] = value;
  }

  let dataDir: string | undefined;
  if (options.dataDir) {
    dataDir = resolve(options.dataDir);
    if (insideGitTree(dataDir)) {
      throw new Error(
        `Data dir ${dataDir} is inside a git working tree. ` +
          'Project data (screenshots, HARs, DBs) must never live in a repo — pick a directory outside any clone.',
      );
    }
  }

  return { ...parsed.data, dir, dataDir, env };
}
