import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, test } from 'vitest';
import { BrowserSession, canLaunchBrowser, captureScreenshot } from './capture.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// These are integration tests; they self-skip where no browser is installed
// (plain CI) and run wherever Chromium is available (dev, the pod). The probe
// is done at module load so `runIf` sees the real value at collection time.
const browserOk = await canLaunchBrowser();

function servePage(html: string): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}/`, server });
    });
  });
}

let server: Server | undefined;
afterAll(() => server?.close());

describe('captureScreenshot', () => {
  test('canLaunchBrowser returns a boolean', () => {
    expect(typeof browserOk).toBe('boolean');
  });

  test.runIf(browserOk)('captures a valid PNG of a served page', async () => {
    const page = await servePage('<html><body style="background:#0a3"><h1>Hi</h1></body></html>');
    server = page.server;
    const png = await captureScreenshot({ url: page.url, viewport: { width: 200, height: 120 } });
    expect(png.length).toBeGreaterThan(100);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  test.runIf(browserOk)('a session captures multiple pages', async () => {
    const page = await servePage('<html><body>x</body></html>');
    server = page.server;
    const s = new BrowserSession();
    await s.open();
    try {
      const a = await s.capture({ url: page.url });
      const b = await s.capture({ url: page.url });
      expect(a.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      expect(b.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    } finally {
      await s.close();
    }
  });
});
