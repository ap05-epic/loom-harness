import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadProfile, saveProfile } from './config.js';

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
    expect(() => loadProfile(dir, { env: {} })).toThrow(/loom\.config\.yaml/);
  });

  test('prefers loom.config.yaml but falls back to the legacy harness.config.yaml', () => {
    // legacy-only: falls back to harness.config.yaml
    writeFileSync(
      join(dir, 'harness.config.yaml'),
      minimalYaml.replace('project: fixture', 'project: legacy'),
    );
    expect(loadProfile(dir, { env: {} }).project).toBe('legacy');
    // both present: loom.config.yaml wins
    writeFileSync(
      join(dir, 'loom.config.yaml'),
      minimalYaml.replace('project: fixture', 'project: loom'),
    );
    expect(loadProfile(dir, { env: {} }).project).toBe('loom');
  });

  test('parses an optional mcp.servers block (external MCP servers to attach)', () => {
    writeFileSync(
      join(dir, 'loom.config.yaml'),
      `${minimalYaml}
mcp:
  servers:
    - name: docs
      command: my-mcp-server
      args: ['--stdio']
`,
    );
    const profile = loadProfile(dir, { env: {} });
    expect(profile.mcp?.servers).toEqual([
      { name: 'docs', command: 'my-mcp-server', args: ['--stdio'] },
    ]);
  });

  test('parses an optional skills.dir block', () => {
    writeFileSync(join(dir, 'loom.config.yaml'), `${minimalYaml}\nskills:\n  dir: ./skills\n`);
    expect(loadProfile(dir, { env: {} }).skills?.dir).toBe('./skills');
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

  test('parses the optional pipeline blocks (source, app, target, eval)', () => {
    writeFileSync(
      join(dir, 'harness.config.yaml'),
      `${minimalYaml}
source:
  strutsConfig: ./legacy-src/WEB-INF/struts-config.xml
app:
  baseUrl: http://127.0.0.1:8090/
target:
  bRepo: b-repo
eval:
  threshold: 1.5
  viewport:
    width: 1440
    height: 900
`,
    );
    const profile = loadProfile(dir, { env: {} });
    expect(profile.source?.strutsConfig).toBe('./legacy-src/WEB-INF/struts-config.xml');
    expect(profile.app?.baseUrl).toBe('http://127.0.0.1:8090/');
    expect(profile.target?.bRepo).toBe('b-repo');
    expect(profile.eval?.threshold).toBe(1.5);
    expect(profile.eval?.viewport).toEqual({ width: 1440, height: 900 });
  });

  test('a minimal profile still validates with the pipeline blocks absent', () => {
    writeFileSync(join(dir, 'harness.config.yaml'), minimalYaml);
    const profile = loadProfile(dir, { env: { LLM_BASE_URL: 'http://x', LLM_API_KEY: 'k' } });
    expect(profile.source).toBeUndefined();
    expect(profile.app).toBeUndefined();
  });

  test('rejects a non-numeric eval threshold', () => {
    writeFileSync(
      join(dir, 'harness.config.yaml'),
      `${minimalYaml}
eval:
  threshold: soon
`,
    );
    expect(() => loadProfile(dir, { env: {} })).toThrow(/threshold/);
  });

  test('parses the crawl block with a form-login auth (creds via env vars)', () => {
    writeFileSync(
      join(dir, 'harness.config.yaml'),
      `${minimalYaml}
crawl:
  startPath: /list
  exclude: ['/logout']
  maxStates: 50
  faEnv: FA_NUMBERS
  auth:
    loginPath: /login
    usernameSelector: 'input[name=username]'
    passwordSelector: 'input[name=password]'
    submitSelector: 'input[type=submit]'
    usernameEnv: APP_USER
    passwordEnv: APP_PASS
`,
    );
    const profile = loadProfile(dir, { env: {} });
    expect(profile.crawl?.startPath).toBe('/list');
    expect(profile.crawl?.exclude).toEqual(['/logout']);
    expect(profile.crawl?.faEnv).toBe('FA_NUMBERS'); // the FA Quick-Search code's env var name
    expect(profile.crawl?.auth?.usernameEnv).toBe('APP_USER');
    expect(profile.crawl?.auth?.loginPath).toBe('/login');
  });
});

describe('saveProfile', () => {
  test('writes a profile loadProfile reads back (round-trip)', () => {
    const path = saveProfile(
      {
        project: 'baa',
        llm: {
          driver: 'openai',
          model: 'gpt-5.4',
          baseUrlEnv: 'LLM_BASE_URL',
          apiKeyEnv: 'LLM_API_KEY',
        },
        source: { strutsConfig: './struts-config.xml' },
        app: { baseUrl: 'https://prod.example/' },
        eval: { threshold: 1.5 },
      },
      dir,
    );
    expect(path).toBe(join(dir, 'loom.config.yaml'));
    const p = loadProfile(dir, { env: {} });
    expect(p.project).toBe('baa');
    expect(p.source?.strutsConfig).toBe('./struts-config.xml');
    expect(p.app?.baseUrl).toBe('https://prod.example/');
    expect(p.eval?.threshold).toBe(1.5);
  });

  test('strips runtime-only fields + secrets, and rejects an invalid config', () => {
    saveProfile(
      {
        project: 'x',
        llm: { driver: 'openai', model: 'm' },
        // runtime-only fields that must never be persisted:
        dir: '/should-not-appear',
        env: { SECRET: 'nope' },
      } as never,
      dir,
    );
    const text = readFileSync(join(dir, 'loom.config.yaml'), 'utf8');
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('should-not-appear');
    // a config missing the required `project` is rejected with a helpful message
    expect(() => saveProfile({ llm: { driver: 'openai', model: 'm' } } as never, dir)).toThrow(
      /project/,
    );
  });
});
