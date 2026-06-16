import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { serveDir, type StaticServer } from './serve.js';

const servers: StaticServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.stop();
});

async function serve(dir: string): Promise<StaticServer> {
  const s = await serveDir(dir);
  servers.push(s);
  return s;
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'serve-'));
}

test('serves index.html at the root with a text/html content-type', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
  const server = await serve(dir);

  const res = await fetch(server.url);

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(await res.text()).toBe('<h1>hi</h1>');
});

test('serves a css file with a text/css content-type', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'style.css'), 'body{color:red}');
  const server = await serve(dir);

  const res = await fetch(`${server.url}/style.css`);

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/css');
  expect(await res.text()).toBe('body{color:red}');
});

test('returns 404 for a missing file', async () => {
  const server = await serve(tmp());

  const res = await fetch(`${server.url}/nope.html`);

  expect(res.status).toBe(404);
});

test('refuses to serve files outside the served directory', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'index.html'), 'root');
  const server = await serve(dir);

  // Encoded traversal that bypasses fetch's own URL normalization.
  const res = await fetch(`${server.url}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);

  expect(res.status).toBe(404);
});

test('exposes the bound port and a loopback url', async () => {
  const server = await serve(tmp());

  expect(server.port).toBeGreaterThan(0);
  expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
});
