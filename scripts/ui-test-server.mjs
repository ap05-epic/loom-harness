/**
 * Dev-only: stand up `loom ui` against the fake Struts fixture in a POD-LIKE single home (config +
 * .env together under LOOM_HOME), for browser testing. Keeps running until killed.
 *   node scripts/ui-test-server.mjs                # configured (chat enabled)
 *   node scripts/ui-test-server.mjs --unconfigured # empty home (tests the SetupBanner reason)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LegacyFixture } from '../packages/test-kit/dist/index.js';

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
const unconfigured = process.argv.includes('--unconfigured');

const fixture = new LegacyFixture({ port: 8190 });
const baseUrl = await fixture.start();
console.log('FIXTURE:', baseUrl);

const home = mkdtempSync(join(tmpdir(), 'loom-home-'));
if (!unconfigured) {
  writeFileSync(
    join(home, 'loom.config.yaml'),
    [
      'project: fixture',
      'llm:',
      '  driver: openai',
      '  model: gpt-5.4',
      '  baseUrlEnv: LLM_BASE_URL',
      '  apiKeyEnv: LLM_API_KEY',
      'source:',
      `  strutsConfig: ${STRUTS}`,
      'app:',
      `  baseUrl: ${baseUrl}`,
      'crawl:',
      '  startPath: /list',
      'eval:',
      '  threshold: 2',
      '',
    ].join('\n'),
  );
}
// .env lives next to the config (the file loom actually reads), with a dummy endpoint so chat is
// ENABLED (turns would fail against the dummy, but the surface + status bar light up).
writeFileSync(
  join(home, '.env'),
  'LLM_API_KEY=test\nLLM_BASE_URL=http://127.0.0.1:9999\nAPP_USER=analyst\nAPP_PASS=analyst\n',
);
console.log('HOME:', home, unconfigured ? '(unconfigured)' : '(configured)');

const ui = spawn('node', [BIN, 'ui', '--port', '7799'], {
  env: { ...process.env, LOOM_HOME: home },
  stdio: 'inherit',
});
const shutdown = () => {
  ui.kill();
  void fixture.stop();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
