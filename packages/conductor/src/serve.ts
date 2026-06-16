import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';

/** A running static-file server; `stop()` releases the port. */
export type StaticServer = {
  url: string;
  port: number;
  stop: () => Promise<void>;
};

export type ServeOptions = {
  /** Bind port (default 0 = ephemeral). */
  port?: number;
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

/**
 * Serve a directory over HTTP for screenshot capture of the builder's b-repo.
 * `/` maps to `index.html`; paths are confined to `dir` (traversal-safe) so a
 * crafted request can never read the legacy source or the harness itself.
 */
export function serveDir(dir: string, options: ServeOptions = {}): Promise<StaticServer> {
  const root = resolve(dir);
  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
        const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const target = resolve(root, rel);
        if (target !== root && !target.startsWith(root + sep)) return notFound(res);
        const info = await stat(target).catch(() => null);
        if (!info || !info.isFile()) return notFound(res);
        res.writeHead(200, {
          'content-type': contentType(target),
          'content-length': info.size,
        });
        createReadStream(target).pipe(res);
      } catch {
        notFound(res);
      }
    })();
  });

  return new Promise<StaticServer>((resolvePromise) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        port,
        stop: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections?.();
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}
