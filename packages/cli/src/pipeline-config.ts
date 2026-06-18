import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { AnthropicDriver, OpenAiDriver, type LlmGateway } from '@loom/agents';
import type { Profile, Viewport } from '@loom/core';
import { configError } from './errors.js';

export type PipelineOverrides = {
  model?: string;
  threshold?: number;
  screens?: string[];
  maxAttempts?: number;
};

/** Everything `loom run`/`map` needs, resolved from a profile + flags. */
export type ResolvedPipeline = {
  project: string;
  model: string;
  strutsConfigPath: string;
  atlasPath: string;
  dbPath: string;
  legacyBaseUrl: string;
  bRepoRoot: string;
  baselineDir: string;
  threshold: number;
  viewport: Viewport;
  screens?: string[];
  maxAttempts?: number;
  /** Directory of SKILL.md files; drafted skills are persisted here. */
  skillsDir?: string;
};

const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 1024 };

function underDir(base: string, p: string): string {
  return isAbsolute(p) ? p : join(base, p);
}

/** Prefer <data-dir>/loom.db; fall back to a legacy harness.db if that's the only one present. */
export function resolveLoomDb(dataDir: string): string {
  const loomDb = join(dataDir, 'loom.db');
  const legacy = join(dataDir, 'harness.db');
  if (!existsSync(loomDb) && existsSync(legacy)) return legacy;
  return loomDb;
}

/**
 * Map a loaded profile (+ command flags) onto the conductor's pipeline inputs.
 * Pure and total: all path/url resolution and the "is this profile wired for a
 * run?" checks live here, so the commands stay thin and this logic is tested
 * without touching the filesystem.
 */
export function resolvePipelineConfig(
  profile: Profile,
  overrides: PipelineOverrides,
): ResolvedPipeline {
  if (!profile.dataDir) {
    throw configError(
      'no data dir resolved for this profile',
      'pass --data-dir <dir> or set LOOM_DATA_DIR (must be outside any git clone)',
    );
  }
  if (!profile.source?.strutsConfig) {
    throw configError(
      'profile has no source.strutsConfig',
      'add a `source.strutsConfig:` path to loom.config.yaml',
    );
  }
  if (!profile.app?.baseUrl) {
    throw configError(
      'profile has no app.baseUrl (the legacy app to crawl)',
      'add an `app.baseUrl:` to loom.config.yaml',
    );
  }

  const dataDir = profile.dataDir;
  return {
    project: profile.project,
    model: overrides.model ?? profile.llm.model,
    strutsConfigPath: underDir(profile.dir, profile.source.strutsConfig),
    atlasPath: join(dataDir, 'codeatlas.db'),
    dbPath: resolveLoomDb(dataDir),
    legacyBaseUrl: profile.app.baseUrl,
    bRepoRoot: underDir(dataDir, profile.target?.bRepo ?? 'b-repo'),
    baselineDir: join(dataDir, 'baseline'),
    threshold: overrides.threshold ?? profile.eval?.threshold ?? 1,
    viewport: profile.eval?.viewport ?? DEFAULT_VIEWPORT,
    screens: overrides.screens,
    maxAttempts: overrides.maxAttempts,
    // Default to a per-project skills dir under the data dir, so drafted skills stay isolated.
    skillsDir: profile.skills?.dir
      ? underDir(profile.dir, profile.skills.dir)
      : join(dataDir, 'skills'),
  };
}

/** A truthy opt-in env flag (1/true/yes/on) — used to un-gate the dormant Anthropic path. */
function optedIn(value: string | undefined): boolean {
  return value != null && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/** Build the LLM gateway from a profile's llm config + resolved env. */
export function gatewayFromProfile(profile: Profile): LlmGateway {
  const { driver, baseUrlEnv, apiKeyEnv } = profile.llm;

  // The copilot driver is disabled — Loom uses the OpenAI/Azure key path only.
  // (CopilotDriver still ships in @loom/agents but is no longer constructed here.)
  if (driver === 'copilot') {
    throw configError(
      'the copilot driver is disabled — Loom now uses the OpenAI/Azure key path only',
      'set llm.driver: openai with LLM_BASE_URL (…/openai/v1) + LLM_API_KEY (e.g. `loom init --driver openai`)',
    );
  }

  // Azure/OpenAI is Loom's sole live connector. The Anthropic driver still ships (for portability
  // outside the bank) but is dormant — un-gate it deliberately with LOOM_ENABLE_ANTHROPIC=1.
  if (driver === 'anthropic' && !optedIn(profile.env.LOOM_ENABLE_ANTHROPIC)) {
    throw configError(
      'the anthropic driver is gated off — Loom connects only via the OpenAI/Azure link + key',
      'set llm.driver: openai with LLM_BASE_URL (…/openai/v1) + LLM_API_KEY; or, for use outside the bank, set LOOM_ENABLE_ANTHROPIC=1 in .env to opt in',
    );
  }

  const base = baseUrlEnv ? profile.env[baseUrlEnv] : undefined;
  const key = apiKeyEnv ? profile.env[apiKeyEnv] : undefined;
  if (!key) {
    throw configError(
      `no API key set (${apiKeyEnv ?? 'LLM_API_KEY'}) — set it in your .env`,
      'add LLM_API_KEY (and LLM_BASE_URL …/openai/v1) to the profile .env',
    );
  }
  if (driver === 'anthropic') {
    return new AnthropicDriver({ apiKey: key, baseUrl: base });
  }
  if (!base) {
    throw configError(
      `LLM base URL not set in the environment (${baseUrlEnv ?? 'LLM_BASE_URL'})`,
      'set the base URL (including the version path, e.g. …/openai/v1) in your .env',
    );
  }
  // The OpenAI-compatible driver covers the Azure v1 surface and any gateway.
  return new OpenAiDriver({ baseUrl: base, apiKey: key });
}

/**
 * Wrap a gateway so it accumulates token usage across every `complete()` call. Lets a long-running
 * driver (e.g. `loom explore`) surface a live running token total — so the operator sees exactly how
 * many tokens are being spent — without threading usage through the chooser/loop. The response is
 * passed through unchanged.
 */
export function trackUsage(gateway: LlmGateway): {
  gateway: LlmGateway;
  total: () => { inputTokens: number; outputTokens: number };
} {
  let inputTokens = 0;
  let outputTokens = 0;
  const tracked: LlmGateway = {
    complete: async (request) => {
      const res = await gateway.complete(request);
      inputTokens += res.usage?.inputTokens ?? 0;
      outputTokens += res.usage?.outputTokens ?? 0;
      return res;
    },
  };
  return { gateway: tracked, total: () => ({ inputTokens, outputTokens }) };
}

/** How the active LLM is reached + whether the model is the user's to choose. */
export type ProviderInfo = {
  driver: 'openai' | 'copilot' | 'anthropic';
  auth: string;
  model: string;
  modelSelectable: boolean;
  note: string;
};

/**
 * Describe the active provider for the operator — the transparency that makes
 * clear whether the harness is using a **GitHub Copilot login** (you choose the
 * model) or an **Azure/OpenAI key** (locked to the configured model).
 */
export function describeProvider(profile: Profile): ProviderInfo {
  const { driver, model, baseUrlEnv, apiKeyEnv } = profile.llm;
  if (driver === 'copilot') {
    return {
      driver,
      auth: 'disabled — Loom is OpenAI/Azure-only; switch llm.driver to openai',
      model,
      modelSelectable: false,
      note: 'The copilot driver is disabled; set llm.driver: openai with a key.',
    };
  }
  if (driver === 'anthropic' && !optedIn(profile.env.LOOM_ENABLE_ANTHROPIC)) {
    return {
      driver,
      auth: 'gated off — Loom connects only via the OpenAI/Azure link + key (set LOOM_ENABLE_ANTHROPIC=1 to opt in)',
      model,
      modelSelectable: false,
      note: 'The anthropic path is dormant; Loom is OpenAI/Azure-only by default.',
    };
  }
  const keySet = Boolean(apiKeyEnv && profile.env[apiKeyEnv]);
  return {
    driver,
    auth: `${driver === 'anthropic' ? 'Anthropic' : 'Azure/OpenAI'} key (BYOK via ${apiKeyEnv ?? 'LLM_API_KEY'}${baseUrlEnv ? ` + ${baseUrlEnv}` : ''})${keySet ? '' : ' — NOT SET'}`,
    model,
    modelSelectable: false,
    note: 'Locked to the configured model; switch models by editing llm.model / the endpoint.',
  };
}
