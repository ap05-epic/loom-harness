import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canLaunchBrowser } from '@loom/browser';
import { openUiAtlas } from '@loom/surveyor';
import { canRunJava, LegacyFixture } from '@loom/test-kit';
import { afterAll, describe, expect, test } from 'vitest';
import { registerAll } from '../index.js';
import { buildProgram } from '../../program.js';

const liveOk = canRunJava() && (await canLaunchBrowser());

let fixture: LegacyFixture | undefined;
afterAll(async () => {
  await fixture?.stop();
});

type RunResult = { stdout: string; exitCode: number };
async function harness(args: string[], env: Record<string, string>): Promise<RunResult> {
  const stdout: string[] = [];
  let exitCode = 0;
  const program = buildProgram(registerAll(), {
    version: '9.9.9',
    env,
    cwd: process.cwd(),
    stdoutTTY: false,
    stdinTTY: false,
    write: (s) => stdout.push(s),
    writeErr: () => {},
    exit: (c) => {
      exitCode = c;
    },
  });
  await program.parseAsync(['node', 'loom', ...args]);
  return { stdout: stdout.join(''), exitCode };
}

describe('loom crawl (live, against the fixture)', () => {
  test.runIf(liveOk)(
    'logs in via the profile and inventories the protected screens',
    async () => {
      fixture = new LegacyFixture({ port: 8145 });
      const base = await fixture.start();

      const profileDir = mkdtempSync(join(tmpdir(), 'crawl-profile-'));
      writeFileSync(
        join(profileDir, 'harness.config.yaml'),
        [
          'project: fixture',
          'llm:',
          '  driver: openai',
          '  model: mock',
          '  baseUrlEnv: LLM_BASE_URL',
          '  apiKeyEnv: LLM_API_KEY',
          'app:',
          `  baseUrl: ${base}`,
          'crawl:',
          '  startPath: /list',
          "  exclude: ['/logout']",
          '  maxStates: 12',
          '  auth:',
          '    loginPath: /login',
          "    usernameSelector: 'input[name=username]'",
          "    passwordSelector: 'input[name=password]'",
          "    submitSelector: 'input[type=submit]'",
          '    usernameEnv: APP_USER',
          '    passwordEnv: APP_PASS',
          '',
        ].join('\n'),
      );

      const dataDir = mkdtempSync(join(tmpdir(), 'crawl-data-'));
      const { stdout, exitCode } = await harness(['crawl', '--json'], {
        HARNESS_PROFILE: profileDir,
        LOOM_DATA_DIR: dataDir,
        APP_USER: 'analyst',
        APP_PASS: 'analyst',
      });

      expect(exitCode).toBe(0);
      const env = JSON.parse(stdout.trim());
      expect(env.ok).toBe(true);
      const urls = (env.data.states as Array<{ url: string }>).map((s) => s.url);
      expect(urls.some((u) => u.includes('/list'))).toBe(true);
      expect(urls.some((u) => u.includes('/wizard'))).toBe(true);
      expect(urls.some((u) => u.includes('/logout'))).toBe(false);

      // the discovered states were persisted into the UI atlas (uiatlas.db)
      expect(env.data.atlasPath).toBeTruthy();
      const atlas = openUiAtlas(env.data.atlasPath as string);
      try {
        expect(atlas.states().length).toBeGreaterThanOrEqual(2);
      } finally {
        atlas.close();
      }
    },
    60_000,
  );
});
