import { join, resolve } from 'node:path';
import { CopilotDriver, OpenAiDriver } from '@loom/agents';
import type { Profile } from '@loom/core';
import { describe, expect, test } from 'vitest';
import { describeProvider, gatewayFromProfile, resolvePipelineConfig } from './pipeline-config.js';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    project: 'fixture',
    dir: resolve('/profiles/fixture'),
    dataDir: resolve('/data/fixture'),
    env: {},
    llm: {
      driver: 'openai',
      model: 'gpt-5.4',
      baseUrlEnv: 'LLM_BASE_URL',
      apiKeyEnv: 'LLM_API_KEY',
    },
    source: { strutsConfig: './legacy/struts-config.xml' },
    app: { baseUrl: 'http://127.0.0.1:8090/' },
    ...overrides,
  } as Profile;
}

describe('resolvePipelineConfig', () => {
  test('derives db/atlas/baseline/skills paths under the data dir', () => {
    const c = resolvePipelineConfig(profile(), {});
    expect(c.dbPath).toBe(join(resolve('/data/fixture'), 'loom.db'));
    expect(c.atlasPath).toBe(join(resolve('/data/fixture'), 'codeatlas.db'));
    expect(c.baselineDir).toBe(join(resolve('/data/fixture'), 'baseline'));
    // each project's drafted skills live under its own data dir (per-project isolation)
    expect(c.skillsDir).toBe(join(resolve('/data/fixture'), 'skills'));
  });

  test('resolves the struts config relative to the profile dir', () => {
    const c = resolvePipelineConfig(profile(), {});
    expect(c.strutsConfigPath).toBe(resolve('/profiles/fixture', './legacy/struts-config.xml'));
  });

  test('defaults the b-repo to <dataDir>/b-repo and honours target.bRepo', () => {
    expect(resolvePipelineConfig(profile(), {}).bRepoRoot).toBe(
      join(resolve('/data/fixture'), 'b-repo'),
    );
    const withTarget = resolvePipelineConfig(profile({ target: { bRepo: 'out/web' } }), {});
    expect(withTarget.bRepoRoot).toBe(join(resolve('/data/fixture'), 'out/web'));
  });

  test('carries the legacy base url and model through', () => {
    const c = resolvePipelineConfig(profile(), {});
    expect(c.legacyBaseUrl).toBe('http://127.0.0.1:8090/');
    expect(c.model).toBe('gpt-5.4');
  });

  test('flag overrides win over profile defaults', () => {
    const c = resolvePipelineConfig(profile({ eval: { threshold: 1.5 } }), {
      model: 'gpt-5.4-mini',
      threshold: 0.5,
      screens: ['login', 'list'],
      maxAttempts: 5,
    });
    expect(c.model).toBe('gpt-5.4-mini');
    expect(c.threshold).toBe(0.5);
    expect(c.screens).toEqual(['login', 'list']);
    expect(c.maxAttempts).toBe(5);
  });

  test('threshold falls back to profile then to 1', () => {
    expect(resolvePipelineConfig(profile({ eval: { threshold: 2 } }), {}).threshold).toBe(2);
    expect(resolvePipelineConfig(profile(), {}).threshold).toBe(1);
  });

  test('viewport defaults to 1280x1024 and honours the profile', () => {
    expect(resolvePipelineConfig(profile(), {}).viewport).toEqual({ width: 1280, height: 1024 });
    const c = resolvePipelineConfig(
      profile({ eval: { viewport: { width: 1440, height: 900 } } }),
      {},
    );
    expect(c.viewport).toEqual({ width: 1440, height: 900 });
  });

  test('requires a data dir', () => {
    expect(() => resolvePipelineConfig(profile({ dataDir: undefined }), {})).toThrow(/data dir/i);
  });

  test('requires source.strutsConfig', () => {
    expect(() => resolvePipelineConfig(profile({ source: undefined }), {})).toThrow(/struts/i);
  });

  test('requires app.baseUrl', () => {
    expect(() => resolvePipelineConfig(profile({ app: undefined }), {})).toThrow(/baseUrl|legacy/i);
  });
});

describe('gatewayFromProfile', () => {
  test('the copilot driver needs no key or URL (GitHub Copilot login)', () => {
    const p = profile({ llm: { driver: 'copilot', model: 'gpt-5.4' }, env: {} });
    expect(gatewayFromProfile(p)).toBeInstanceOf(CopilotDriver);
  });

  test('the openai driver builds from the env key + URL', () => {
    const p = profile({
      llm: {
        driver: 'openai',
        model: 'gpt-5.4',
        baseUrlEnv: 'LLM_BASE_URL',
        apiKeyEnv: 'LLM_API_KEY',
      },
      env: { LLM_BASE_URL: 'http://x/openai/v1', LLM_API_KEY: 'k' },
    });
    expect(gatewayFromProfile(p)).toBeInstanceOf(OpenAiDriver);
  });

  test('a keyless openai profile errors and points at the copilot login', () => {
    const p = profile({
      llm: { driver: 'openai', model: 'gpt-5.4', apiKeyEnv: 'LLM_API_KEY' },
      env: {},
    });
    expect(() => gatewayFromProfile(p)).toThrow(/copilot/i);
  });
});

describe('describeProvider', () => {
  test('copilot: GitHub login, model is selectable', () => {
    const info = describeProvider(profile({ llm: { driver: 'copilot', model: 'gpt-5.4' } }));
    expect(info.modelSelectable).toBe(true);
    expect(info.auth).toMatch(/copilot/i);
  });

  test('azure key: locked to the configured model', () => {
    const info = describeProvider(
      profile({ llm: { driver: 'openai', model: 'gpt-5.4', apiKeyEnv: 'LLM_API_KEY' } }),
    );
    expect(info.modelSelectable).toBe(false);
    expect(info.auth).toMatch(/key/i);
  });
});
