import { describe, expect, test } from 'vitest';
import { canLaunchBrowser, CrawlSession } from './capture.js';

// Self-skips where no browser is available.
const liveOk = await canLaunchBrowser();

describe('CrawlSession.captureA11y', () => {
  test.runIf(liveOk)(
    'runs axe-core and reports violations on an inaccessible page',
    async () => {
      const html = '<!doctype html><html><body><img src="logo.png"><button></button></body></html>';
      const session = new CrawlSession();
      await session.open();
      try {
        await session.navigate(`data:text/html,${encodeURIComponent(html)}`);
        const violations = await session.captureA11y();
        // a page with no lang/title, an alt-less image, and an empty button has violations
        expect(violations.length).toBeGreaterThan(0);
        expect(violations[0]).toMatchObject({
          id: expect.any(String),
          count: expect.any(Number),
        });
      } finally {
        await session.close();
      }
    },
    30_000,
  );
});
