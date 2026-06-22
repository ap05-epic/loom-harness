import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

/** Run the React app's build command (e.g. `vite build`) in its directory. */
export function runAppBuild(appDir: string, buildCmd: string): { ok: boolean; output: string } {
  const r = spawnSync(buildCmd, { cwd: appDir, shell: true, encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { ok: r.status === 0, output };
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Serve a built static directory (a Vite/React `dist`) with SPA fallback — unknown paths return
 * `index.html` so client‑side routes render. Returns the base URL + a stop handle. Used to host the
 * replica so the deterministic checker can capture it.
 */
export async function serveStatic(
  dir: string,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const indexHtml = join(dir, 'index.html');
  const server = createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    // Resolve within dir; strip any leading ../ so a request can't escape the served root.
    const safe = normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
    let file = join(dir, safe);
    if (!existsSync(file) || !statSync(file).isFile()) file = indexHtml; // SPA fallback
    try {
      const buf = readFileSync(file);
      res.setHeader(
        'content-type',
        CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      );
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
