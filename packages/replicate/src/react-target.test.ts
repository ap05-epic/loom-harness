import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runAppBuild, serveStatic } from './react-target.js';

describe('runAppBuild', () => {
  test('reports ok + captures output on a zero-exit build command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-'));
    const r = runAppBuild(dir, `node -e "process.stdout.write('built')"`);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('built');
  });

  test('reports failure + captures the error on a non-zero build command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-'));
    const r = runAppBuild(dir, `node -e "process.stderr.write('boom'); process.exit(1)"`);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('boom');
  });
});

describe('serveStatic', () => {
  test('serves real files and falls back to index.html for unknown (SPA) routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-serve-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title><h1>home</h1>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    const { url, stop } = await serveStatic(dir);
    try {
      const js = await fetch(`${url}/assets/app.js`);
      expect(await js.text()).toContain('console.log');
      expect(js.headers.get('content-type')).toContain('javascript');
      const spa = await fetch(`${url}/some/client/route`); // unknown → index.html
      expect(await spa.text()).toContain('home');
    } finally {
      await stop();
    }
  });
});
