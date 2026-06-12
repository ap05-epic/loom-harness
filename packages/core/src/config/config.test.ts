import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadProfile } from './config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-config-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const minimalYaml = `
project: fixture
llm:
  driver: openai
  model: gpt-5.4
  baseUrlEnv: LLM_BASE_URL
  apiKeyEnv: LLM_API_KEY
`;

describe('loadProfile', () => {
  test('loads and validates a minimal profile', () => {
    writeFileSync(join(dir, 'harness.config.yaml'), minimalYaml);
    const profile = loadProfile(dir, { env: { LLM_BASE_URL: 'http://x', LLM_API_KEY: 'k' } });
    expect(profile.project).toBe('fixture');
    expect(profile.llm.driver).toBe('openai');
    expect(profile.llm.model).toBe('gpt-5.4');
    expect(profile.dir).toBe(dir);
  });

  test('merges .env file values, with real environment winning over .env', () => {
    writeFileSync(join(dir, 'harness.config.yaml'), minimalYaml);
    writeFileSync(join(dir, '.env'), 'LLM_API_KEY=from-dotenv\nLLM_BASE_URL=http://dotenv\n');
    const profile = loadProfile(dir, { env: { LLM_API_KEY: 'from-real-env' } });
    expect(profile.env.LLM_API_KEY).toBe('from-real-env');
    expect(profile.env.LLM_BASE_URL).toBe('http://dotenv');
  });

  test('.env parsing handles comments, blank lines, and quoted values', () => {
    writeFileSync(join(dir, 'harness.config.yaml'), minimalYaml);
    writeFileSync(
      join(dir, '.env'),
      '# comment\n\nLLM_API_KEY="quoted value"\nLLM_BASE_URL=http://plain # trailing comments are not stripped\n',
    );
    const profile = loadProfile(dir, { env: {} });
    expect(profile.env.LLM_API_KEY).toBe('quoted value');
    expect(profile.env.LLM_BASE_URL).toBe('http://plain # trailing comments are not stripped');
  });

  test('rejects a missing config file with a helpful message', () => {
    expect(() => loadProfile(dir, { env: {} })).toThrow(/harness\.config\.yaml/);
  });

  test('rejects an unknown llm driver', () => {
    writeFileSync(
      join(dir, 'harness.config.yaml'),
      minimalYaml.replace('driver: openai', 'driver: banana'),
    );
    expect(() => loadProfile(dir, { env: {} })).toThrow(/driver/);
  });

  test('optional model profile overrides are carried through', () => {
    writeFileSync(
      join(dir, 'harness.config.yaml'),
      `${minimalYaml}
  modelProfile:
    contextWindow: 1050000
    maxOutput: 128000
    vision: true
`,
    );
    const profile = loadProfile(dir, { env: {} });
    expect(profile.llm.modelProfile?.contextWindow).toBe(1050000);
    expect(profile.llm.modelProfile?.vision).toBe(true);
  });

  test('refuses a data dir inside a git working tree', () => {
    writeFileSync(join(dir, 'harness.config.yaml'), minimalYaml);
    mkdirSync(join(dir, '.git'));
    expect(() => loadProfile(dir, { env: {}, dataDir: join(dir, 'data') })).toThrow(/git/i);
  });
});
