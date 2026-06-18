import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockLlmServer } from '@loom/test-kit';
import { afterEach, describe, expect, test } from 'vitest';
import { registerAll } from '../index.js';
import { buildProgram } from '../../program.js';

const mocks: MockLlmServer[] = [];
afterEach(async () => {
  while (mocks.length) await mocks.pop()!.stop();
});

const STRUTS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
  'WEB-INF',
  'struts-config.xml',
);

type RunResult = { stdout: string; stderr: string; exitCode: number };
async function run(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;
  const program = buildProgram(registerAll(), {
    version: '9.9.9',
    env,
    cwd: process.cwd(),
    stdoutTTY: false,
    stdinTTY: false,
    write: (s) => stdout.push(s),
    writeErr: (s) => stderr.push(s),
    exit: (c) => {
      exitCode = c;
    },
  });
  await program.parseAsync(['node', 'loom', ...args]);
  return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode };
}

/** Build the enriched atlas from the fixture and return its path. */
async function builtAtlas(): Promise<string> {
  const atlas = join(mkdtempSync(join(tmpdir(), 'cli-atlas-')), 'codeatlas.db');
  const { exitCode } = await run(['map', '--struts', STRUTS, '--atlas', atlas, '--json']);
  expect(exitCode).toBe(0);
  return atlas;
}

describe('loom atlas (reads a built atlas)', () => {
  test('map reports tile layouts and JSP counts from the enriched atlas', async () => {
    const atlas = join(mkdtempSync(join(tmpdir(), 'cli-atlas-')), 'codeatlas.db');
    const { stdout } = await run(['map', '--struts', STRUTS, '--atlas', atlas, '--json']);
    const env = JSON.parse(stdout.trim());
    expect(env.data.tiles).toBe(5);
    expect(env.data.jsps).toBeGreaterThanOrEqual(5);
  });

  test('atlas repomap prints a whole-app overview naming every screen', async () => {
    const atlas = await builtAtlas();
    const { stdout, exitCode } = await run([
      'atlas',
      'repomap',
      '--atlas',
      atlas,
      '--project',
      'fixture',
      '--json',
    ]);
    expect(exitCode).toBe(0);
    const map = JSON.parse(stdout.trim()).data.repoMap as string;
    for (const key of ['login', 'list', 'wizard', 'popup', 'logout']) expect(map).toContain(key);
  });

  test('atlas repomap falls back to the profile data dir when no --atlas/--data-dir (the ~/.loom home)', async () => {
    // The zero-config home: `loom map` wrote codeatlas.db into the profile's data dir, and the user
    // runs `loom atlas repomap` with no flags. The data dir comes from env (LOOM_DATA_DIR), which
    // populates profile.dataDir but NOT ctx.flags.dataDir — so the atlas command must fall back to
    // the profile, exactly like `map` does.
    const atlas = await builtAtlas();
    const dataDir = dirname(atlas);
    const profileDir = mkdtempSync(join(tmpdir(), 'cli-atlas-profile-'));
    writeFileSync(
      join(profileDir, 'harness.config.yaml'),
      [
        'project: fixture',
        'llm:',
        '  driver: openai',
        '  model: mock',
        '  baseUrlEnv: LLM_BASE_URL',
        '  apiKeyEnv: LLM_API_KEY',
        '',
      ].join('\n'),
    );
    const env = { HARNESS_PROFILE: profileDir, LOOM_DATA_DIR: dataDir };
    const { stdout, exitCode } = await run(['atlas', 'repomap', '--json'], env);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim()).data.repoMap as string).toContain('login');
  });

  test('atlas slice details one screen’s forms and taglibs', async () => {
    const atlas = await builtAtlas();
    const { stdout, exitCode } = await run(['atlas', 'slice', 'login', '--atlas', atlas, '--json']);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout.trim()).data;
    expect(data.action).toBe('/login');
    expect(data.forms[0].fields.map((f: { property: string }) => f.property)).toEqual([
      'username',
      'password',
    ]);
    expect(data.taglibs).toContain('html');
  });

  test('atlas slice on an unknown screen is NOT_FOUND (exit 9)', async () => {
    const atlas = await builtAtlas();
    const { stdout, exitCode } = await run(['atlas', 'slice', 'nope', '--atlas', atlas, '--json']);
    expect(exitCode).toBe(9);
    expect(JSON.parse(stdout.trim()).error.code).toBe('NOT_FOUND');
  });

  test('atlas find searches the atlas for matching nodes', async () => {
    const atlas = await builtAtlas();
    const { stdout, exitCode } = await run(['atlas', 'find', 'login', '--atlas', atlas, '--json']);
    expect(exitCode).toBe(0);
    const names = (JSON.parse(stdout.trim()).data.results as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(names).toContain('/login');
    expect(names).toContain('/jsp/login.jsp');
  });

  test('atlas summarize generates the missing docs (mock LLM) and they become searchable', async () => {
    const atlas = await builtAtlas();
    const mock = new MockLlmServer();
    mocks.push(mock);
    const { baseUrl: llmUrl } = await mock.start();
    mock.enqueueText('Authentication entry point for analysts.', { repeat: true });

    const profileDir = mkdtempSync(join(tmpdir(), 'cli-sum-profile-'));
    writeFileSync(
      join(profileDir, 'harness.config.yaml'),
      [
        'project: fixture',
        'llm:',
        '  driver: openai',
        '  model: mock',
        '  baseUrlEnv: LLM_BASE_URL',
        '  apiKeyEnv: LLM_API_KEY',
        '',
      ].join('\n'),
    );

    const env = { HARNESS_PROFILE: profileDir, LLM_BASE_URL: llmUrl, LLM_API_KEY: 'test' };
    const { stdout, exitCode } = await run(['atlas', 'summarize', '--atlas', atlas, '--json'], env);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim()).data.screensSummarized).toBe(5);

    const find = await run(['atlas', 'find', 'analysts', '--atlas', atlas, '--json'], env);
    const names = (JSON.parse(find.stdout.trim()).data.results as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(names).toContain('/login');
  });
});
