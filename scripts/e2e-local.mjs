/**
 * Local end-to-end smoke of the REAL `loom` CLI against the bundled fake Struts app
 * (fixtures/legacy-webapp) with a deterministic mock LLM — no API key, no network.
 *
 *   node scripts/e2e-local.mjs
 *
 * Proves the deployable binary, not just the in-process test harness: it shells out to
 * packages/cli/dist/bin.js for `map`, then `run` (which does CRAWL → BUILD → EVAL internally), and
 * asserts the login screen reaches `passed`. Profile + data dirs are temp dirs outside the clone.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LegacyFixture, MockLlmServer } from '../packages/test-kit/dist/index.js';

const ROOT = process.cwd();
const BIN = join(ROOT, 'packages', 'cli', 'dist', 'bin.js');
const STRUTS = join(
  ROOT,
  'fixtures',
  'legacy-webapp',
  'legacy-src',
  'WEB-INF',
  'struts-config.xml',
).replace(/\\/g, '/');

const fixture = new LegacyFixture({ port: 8190 });
const mock = new MockLlmServer();
let profileDir,
  dataDir,
  ok = false;
try {
  const baseUrl = await fixture.start();
  const html = await (await fetch(`${baseUrl}login`)).text();
  const css = await (await fetch(`${baseUrl}style.css`)).text();

  const { baseUrl: llmUrl } = await mock.start();
  mock.enqueueToolCall('write_file', { path: 'index.html', content: html });
  mock.enqueueToolCall('write_file', { path: 'style.css', content: css });
  mock.enqueueText('Rebuilt the login screen.');

  profileDir = mkdtempSync(join(tmpdir(), 'loom-e2e-profile-'));
  dataDir = mkdtempSync(join(tmpdir(), 'loom-e2e-data-'));
  writeFileSync(
    join(profileDir, 'loom.config.yaml'),
    [
      'project: fixture',
      'llm:',
      '  driver: openai',
      '  model: mock',
      '  baseUrlEnv: LLM_BASE_URL',
      '  apiKeyEnv: LLM_API_KEY',
      'source:',
      `  strutsConfig: ${STRUTS}`,
      'app:',
      `  baseUrl: ${baseUrl}`,
      'crawl:',
      '  startPath: /list',
      "  exclude: ['/logout']",
      '  maxStates: 8',
      '  auth:',
      '    loginPath: /login',
      "    usernameSelector: 'input[name=username]'",
      "    passwordSelector: 'input[name=password]'",
      "    submitSelector: 'input[type=submit]'",
      '    usernameEnv: APP_USER',
      '    passwordEnv: APP_PASS',
      'eval:',
      '  threshold: 2',
      '',
    ].join('\n'),
  );

  const env = {
    ...process.env,
    LLM_BASE_URL: llmUrl,
    LLM_API_KEY: 'test',
    APP_USER: 'analyst',
    APP_PASS: 'analyst',
  };
  // Async spawn (NOT spawnSync): the mock LLM runs in THIS process's event loop, so a blocking
  // spawnSync would deadlock — the spawned CLI's LLM calls could never be served. Await each child.
  const cli = (args) =>
    new Promise((resolve) => {
      const child = spawn(
        'node',
        [BIN, ...args, '--profile', profileDir, '--data-dir', dataDir, '--json'],
        { env },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
      child.on('close', (status, signal) => {
        clearTimeout(timer);
        resolve({ status, signal, stdout, stderr });
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ status: -1, stdout, stderr: String(e) });
      });
    });

  const map = await cli(['map']);
  const mapData = JSON.parse(map.stdout.trim());
  const screens = mapData.data?.screens ?? mapData.data?.actions ?? '?';
  console.log(
    `map      → exit ${map.status} (screens: ${Array.isArray(screens) ? screens.length : screens})`,
  );

  const run = await cli(['run', '--screens', 'login']);
  if (run.status !== 0 || !run.stdout.trim()) {
    console.log(`run      → exit ${run.status} (signal ${run.signal})`);
    console.log('STDERR:', (run.stderr || '').slice(-1000));
    throw new Error('run produced no JSON');
  }
  const runData = JSON.parse(run.stdout.trim());
  const s = runData.data?.screens?.[0];
  console.log(
    `run      → exit ${run.status} | passed=${runData.data?.passed} failed=${runData.data?.failed} | ${s?.screenKey}:${s?.state} diff=${s?.diffPercent}%`,
  );
  ok = run.status === 0 && runData.data?.passed === 1 && s?.state === 'passed';
} finally {
  await fixture.stop();
  await mock.stop();
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
console.log(
  ok
    ? '\n✅ LOCAL E2E PASSED — real CLI took the fixture login to a passing rebuild.'
    : '\n❌ LOCAL E2E FAILED.',
);
process.exit(ok ? 0 : 1);
