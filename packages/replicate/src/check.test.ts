import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { canLaunchBrowser } from '@loom/browser';
import { checkParity } from './check.js';

const PAGE = (heading: string, links: string): string =>
  `<!doctype html><html><head><style>h1{color:#000;font-size:24px}</style></head>` +
  `<body><h1>${heading}</h1><form action="/auth"><input name="user" type="text"></form>${links}</body></html>`;

const LEGACY = PAGE('Login', '<a href="/list">List</a>');
const DIFFERENT = PAGE('Welcome', ''); // changed heading text + dropped the /list link

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(req.url?.includes('different') ? DIFFERENT : LEGACY);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const hasBrowser = await canLaunchBrowser();

describe.skipIf(!hasBrowser)('checkParity (live, deterministic — no LLM)', () => {
  test('identical pages → 1:1 match', async () => {
    const r = await checkParity({
      legacyUrl: `${base}/legacy`,
      replicaUrl: `${base}/legacy`,
      threshold: 1,
    });
    expect(r.matched).toBe(true);
  }, 30_000);

  test('real differences → not matched, with concrete machine-found findings', async () => {
    const r = await checkParity({
      legacyUrl: `${base}/legacy`,
      replicaUrl: `${base}/different`,
      threshold: 1,
    });
    expect(r.matched).toBe(false);
    // the machine caught at least one concrete difference (structure or visual), with zero LLM involvement
    expect(r.dom.length + r.style.length + (r.visualPct > 1 ? 1 : 0)).toBeGreaterThan(0);
  }, 30_000);
});
