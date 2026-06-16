import { canLaunchBrowser } from '@loom/browser';
import { canRunJava, LegacyFixture } from '@loom/test-kit';
import { afterAll, describe, expect, test } from 'vitest';
import { crawlApp } from './crawl-app.js';

// The live crawler needs a JDK (the fixture) and a launchable browser.
const liveOk = canRunJava() && (await canLaunchBrowser());

let fixture: LegacyFixture | undefined;
afterAll(async () => {
  await fixture?.stop();
});

describe('crawlApp (live, authenticated crawl of the fixture)', () => {
  test.runIf(liveOk)(
    'logs in and walks the protected app: finds the list and the wizard',
    async () => {
      fixture = new LegacyFixture({ port: 8144 });
      const base = await fixture.start();

      const result = await crawlApp({
        startUrl: `${base}list`,
        auth: {
          url: `${base}login`,
          usernameSelector: 'input[name=username]',
          passwordSelector: 'input[name=password]',
          username: 'analyst',
          password: 'analyst',
          submitSelector: 'input[type=submit]',
        },
        exclude: (url) => url.includes('/logout'), // never log ourselves out mid-crawl
        maxStates: 12,
      });

      const urls = result.states.map((s) => s.url);
      expect(result.states.length).toBeGreaterThanOrEqual(2);
      expect(urls.some((u) => u.includes('/list'))).toBe(true);
      expect(urls.some((u) => u.includes('/wizard'))).toBe(true);
      // logout was excluded, so the session never died mid-crawl
      expect(urls.some((u) => u.includes('/logout'))).toBe(false);
    },
    60_000,
  );
});
