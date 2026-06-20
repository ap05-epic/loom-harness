/**
 * Dev-only: verify `loom ui` STAYS UP (serves /) and explains WHY chat is off for the broken/empty
 * config cases — the lockout + chat-disabled-reason fixes. No browser needed.
 *   node scripts/ui-states-check.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(process.cwd(), 'packages', 'cli', 'dist', 'bin.js');

async function check(name, port, configYaml, envContent) {
  const home = mkdtempSync(join(tmpdir(), `loom-${name}-`));
  if (configYaml) writeFileSync(join(home, 'loom.config.yaml'), configYaml);
  writeFileSync(join(home, '.env'), envContent ?? '');
  const ui = spawn('node', [BIN, 'ui', '--port', String(port)], {
    env: { ...process.env, LOOM_HOME: home },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 3500));
  let root = 0,
    chat = 0,
    reason = '';
  try {
    root = (await fetch(`http://127.0.0.1:${port}/`)).status;
    const ci = await fetch(`http://127.0.0.1:${port}/api/chat/info`);
    chat = ci.status;
    reason = chat === 503 ? ((await ci.json()).disabledReason ?? '') : '(enabled)';
  } catch (e) {
    reason = 'FETCH FAIL ' + e.message;
  }
  ui.kill();
  console.log(`${name.padEnd(13)} GET / → ${root} | chat-info → ${chat} | ${reason}`);
}

await check('unconfigured', 7791, null, '');
await check(
  'broken-key',
  7792,
  'project: bad\nllm:\n  driver: openai\n  model: gpt-5.4\n  apiKeyEnv: MISSING_LLM_KEY\n  baseUrlEnv: LLM_BASE_URL\n',
  'LLM_BASE_URL=http://x/openai/v1\n',
);
process.exit(0);
