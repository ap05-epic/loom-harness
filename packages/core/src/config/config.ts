import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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

const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** Where the legacy source lives (the MAP input). */
const sourceSchema = z.object({
  /** Path to struts-config.xml, relative to the profile dir or absolute. */
  strutsConfig: z.string().min(1),
});

/** The running legacy app — the "A" baseline the surveyor crawls. */
const appSchema = z.object({
  baseUrl: z.string().url(),
  /** Reusable saved auth state (cookies/localStorage) for SSO-gated apps. */
  storageStatePath: z.string().optional(),
});

/** Where rebuilds are written (the "B" side). */
const targetSchema = z.object({
  /** b-repo output dir, relative to the data dir or absolute (default: b-repo). */
  bRepo: z.string().min(1).optional(),
});

const evalSchema = z.object({
  /** Max acceptable visual diff %% (default 1). */
  threshold: z.number().nonnegative().optional(),
  viewport: viewportSchema.optional(),
});

/** Form-login bootstrap; credentials come from env vars, never the file. */
const crawlAuthSchema = z.object({
  loginPath: z.string().min(1),
  usernameSelector: z.string().min(1),
  passwordSelector: z.string().min(1),
  submitSelector: z.string().min(1),
  /** Env var names holding the username/password. */
  usernameEnv: z.string().min(1),
  passwordEnv: z.string().min(1),
  /** Wait for this selector after submit to confirm login landed. */
  waitForSelector: z.string().optional(),
});

const crawlSchema = z.object({
  /** Path (relative to app.baseUrl) to start crawling from after auth. */
  startPath: z.string().optional(),
  /** URL substrings to never follow (e.g. "/logout"). */
  exclude: z.array(z.string()).optional(),
  maxStates: z.number().int().positive().optional(),
  /** Env var holding the FA Quick-Search code the explorer types as `$fa` (default 'fa_numbers'). */
  faEnv: z.string().min(1).optional(),
  auth: crawlAuthSchema.optional(),
});

/** An external MCP server to attach (its tools flow through the L1 registry + hooks). */
const mcpServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
});

const mcpSchema = z.object({
  servers: z.array(mcpServerSchema),
});

/** Where the project's SKILL.md files live (bundled + project skills). */
const skillsSchema = z.object({
  dir: z.string().min(1).optional(),
});

const profileSchema = z.object({
  project: z.string().min(1),
  llm: llmSchema,
  source: sourceSchema.optional(),
  app: appSchema.optional(),
  target: targetSchema.optional(),
  eval: evalSchema.optional(),
  crawl: crawlSchema.optional(),
  mcp: mcpSchema.optional(),
  skills: skillsSchema.optional(),
});

export type LlmConfig = z.infer<typeof llmSchema>;
export type ModelProfileOverrides = z.infer<typeof modelProfileSchema>;
export type SourceConfig = z.infer<typeof sourceSchema>;
export type AppConfig = z.infer<typeof appSchema>;
export type TargetConfig = z.infer<typeof targetSchema>;
export type EvalConfig = z.infer<typeof evalSchema>;
export type CrawlConfig = z.infer<typeof crawlSchema>;
export type CrawlAuthConfig = z.infer<typeof crawlAuthSchema>;
export type McpConfig = z.infer<typeof mcpSchema>;
export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type SkillsConfig = z.infer<typeof skillsSchema>;
export type Viewport = z.infer<typeof viewportSchema>;

export type Profile = z.infer<typeof profileSchema> & {
  /** Profile directory (where loom.config.yaml lives). */
  dir: string;
  /** Resolved data directory, if provided. */
  dataDir?: string;
  /** Merged environment: .env file values overlaid by the real environment. */
  env: Record<string, string>;
};

/** A profile's persisted config — everything written to loom.config.yaml (no runtime fields). */
export type ProfileConfig = z.infer<typeof profileSchema>;

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
  // Prefer loom.config.yaml; fall back to the legacy harness.config.yaml name.
  const loomPath = join(dir, 'loom.config.yaml');
  const legacyPath = join(dir, 'harness.config.yaml');
  const configPath = existsSync(loomPath) ? loomPath : legacyPath;
  if (!existsSync(configPath)) {
    throw new Error(`No loom.config.yaml found in ${dir}`);
  }

  const raw: unknown = parseYaml(readFileSync(configPath, 'utf8'));
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid ${basename(configPath)}: ${issues}`);
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

/**
 * Write a project's config to `<dir>/loom.config.yaml`, validated against the schema. Runtime-only
 * fields (dir/dataDir/env) and any unknown keys are dropped by the parse, and secrets are never
 * written (they live in .env). Round-trips through {@link loadProfile}. Returns the written path.
 */
export function saveProfile(config: ProfileConfig, dir: string): string {
  const parsed = profileSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid profile: ${issues}`);
  }
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'loom.config.yaml');
  writeFileSync(path, stringifyYaml(parsed.data), 'utf8');
  return path;
}
