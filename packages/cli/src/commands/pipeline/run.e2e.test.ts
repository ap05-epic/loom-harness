import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canLaunchBrowser } from '@loom/browser';
import { canRunJava, LegacyFixture, MockLlmServer } from '@loom/test-kit';
import { afterAll, describe, expect, test } from 'vitest';
import { registerAll } from '../index.js';
import { buildProgram } from '../../program.js';

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

// "One command from MAP to a passing rebuild" — needs the JDK (legacy fixture)
// and a launchable browser (A/B capture). Self-skips where either is absent.
const liveOk = canRunJava() && (await canLaunchBrowser());

let fixture: LegacyFixture | undefined;
let mock: MockLlmServer | undefined;
afterAll(async () => {
  await fixture?.stop();
  await mock?.stop();
});

type RunResult = { stdout: string; stderr: string; exitCode: number };
async function harness(args: string[], env: Record<string, string>): Promise<RunResult> {
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

describe('loom run (real fixture → passing rebuild)', () => {
  test.runIf(liveOk)(
    'takes the fixture login from MAP to a passing screen in one command',
    async () => {
      fixture = new LegacyFixture({ port: 8143 });
      const baseUrl = await fixture.start();
      const html = await (await fetch(`${baseUrl}login`)).text();
      const css = await (await fetch(`${baseUrl}style.css`)).text();

      mock = new MockLlmServer();
      const { baseUrl: llmUrl } = await mock.start();
      mock.enqueueToolCall('write_file', { path: 'index.html', content: html });
      mock.enqueueToolCall('write_file', { path: 'style.css', content: css });
      mock.enqueueText('Rebuilt the login screen.');

      const profileDir = mkdtempSync(join(tmpdir(), 'harness-profile-'));
      const dataDir = mkdtempSync(join(tmpdir(), 'harness-data-'));
      writeFileSync(
        join(profileDir, 'harness.config.yaml'),
        [
          'project: fixture',
          'llm:',
          '  driver: openai',
          '  model: mock',
          '  baseUrlEnv: LLM_BASE_URL',
          '  apiKeyEnv: LLM_API_KEY',
          'source:',
          `  strutsConfig: ${STRUTS.replace(/\\/g, '/')}`,
          'app:',
          `  baseUrl: ${baseUrl}`,
          'eval:',
          '  threshold: 2',
          '',
        ].join('\n'),
      );

      const { stdout, exitCode } = await harness(['run', '--screens', 'login', '--json'], {
        HARNESS_PROFILE: profileDir,
        HARNESS_DATA_DIR: dataDir,
        LLM_BASE_URL: llmUrl,
        LLM_API_KEY: 'test',
      });

      const env = JSON.parse(stdout.trim());
      expect(env, stdout).toMatchObject({ ok: true, command: 'run' });
      expect(env.data.passed).toBe(1);
      expect(env.data.failed).toBe(0);
      expect(env.data.screens[0]).toMatchObject({ screenKey: 'login', state: 'passed' });
      expect(env.data.screens[0].diffPercent).toBeLessThanOrEqual(2);
      expect(exitCode).toBe(0);
    },
    60_000,
  );
});
