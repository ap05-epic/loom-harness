import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAiDriver } from '@loom/agents';
import { MockLlmServer } from '@loom/test-kit';
import { afterEach, expect, test } from 'vitest';
import { buildScreen, createWriteFileTool } from './builder.js';

const mocks: MockLlmServer[] = [];
afterEach(async () => {
  while (mocks.length) await mocks.pop()!.stop();
});

async function mockGateway(): Promise<{ gateway: OpenAiDriver; mock: MockLlmServer }> {
  const mock = new MockLlmServer();
  mocks.push(mock);
  const { baseUrl } = await mock.start();
  return { gateway: new OpenAiDriver({ baseUrl, apiKey: 'test' }), mock };
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'builder-'));
}

test('write_file writes a file inside the b-repo and records it', async () => {
  const dir = tmp();
  const { tool, written } = createWriteFileTool(dir);

  const msg = await tool.execute({ path: 'index.html', content: '<h1>Login</h1>' });

  expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe('<h1>Login</h1>');
  expect(written).toEqual(['index.html']);
  expect(msg).toContain('index.html');
});

test('write_file creates nested directories', async () => {
  const dir = tmp();
  const { tool } = createWriteFileTool(dir);

  await tool.execute({ path: 'assets/css/app.css', content: 'body{}' });

  expect(readFileSync(join(dir, 'assets', 'css', 'app.css'), 'utf8')).toBe('body{}');
});

test('write_file refuses a relative path that escapes the b-repo', async () => {
  const dir = tmp();
  const { tool, written } = createWriteFileTool(dir);

  const msg = await tool.execute({ path: '../escape.txt', content: 'pwned' });

  expect(msg.toLowerCase()).toContain('refused');
  expect(written).toEqual([]);
  expect(existsSync(join(dir, '..', 'escape.txt'))).toBe(false);
});

test('write_file refuses an absolute path', async () => {
  const dir = tmp();
  const { tool } = createWriteFileTool(dir);
  const abs = process.platform === 'win32' ? 'C:\\windows\\evil.txt' : '/tmp/evil.txt';

  const msg = await tool.execute({ path: abs, content: 'pwned' });

  expect(msg.toLowerCase()).toContain('refused');
});

test('write_file rejects non-string arguments without throwing', async () => {
  const { tool } = createWriteFileTool(tmp());

  const msg = await tool.execute({ path: 42, content: null });

  expect(msg.toLowerCase()).toContain('error');
});

test('buildScreen runs the agent loop and lands the written files in the b-repo', async () => {
  const dir = tmp();
  const { gateway, mock } = await mockGateway();
  mock.enqueueToolCall('write_file', { path: 'index.html', content: '<h1>Login</h1>' });
  mock.enqueueToolCall('write_file', { path: 'style.css', content: 'body{color:#333}' });
  mock.enqueueText('Done — rebuilt the login screen.');

  const result = await buildScreen({
    gateway,
    model: 'mock',
    bRepoDir: dir,
    workOrder: 'Rebuild the legacy login screen as static HTML+CSS.',
  });

  expect(result.status).toBe('completed');
  expect(result.filesWritten).toEqual(['index.html', 'style.css']);
  expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe('<h1>Login</h1>');
  expect(result.finalText).toContain('Done');
  expect(result.usage.outputTokens).toBeGreaterThan(0);
});

test('buildScreen reports a tripped guard instead of looping forever', async () => {
  const dir = tmp();
  const { gateway, mock } = await mockGateway();
  // Model keeps asking to write the same file — no progress, never finishes.
  mock.enqueueToolCall('write_file', { path: 'index.html', content: 'loop' }, { repeat: true });

  const result = await buildScreen({
    gateway,
    model: 'mock',
    bRepoDir: dir,
    workOrder: 'Rebuild login.',
    guards: { maxIterations: 5 },
  });

  expect(result.status).toBe('guard_tripped');
  expect(result.guard).toBeDefined();
});
