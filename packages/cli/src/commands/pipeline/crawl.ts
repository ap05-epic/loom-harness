import { join } from 'node:path';
import type { Profile } from '@loom/core';
import { crawlApp, openUiAtlas, type CrawlAppOptions } from '@loom/surveyor';
import { configError } from '../../errors.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';

type CrawlData = {
  startUrl: string;
  visited: number;
  truncated: boolean;
  states: Array<{ key: string; url: string; links: number }>;
  /** Where the discovered states were persisted (the UI atlas), if a data dir is set. */
  atlasPath?: string;
};

/** Build the surveyor's crawl options from the profile (creds come from env). */
function crawlOptionsFrom(profile: Profile, maxStatesOverride?: number): CrawlAppOptions {
  const baseUrl = profile.app?.baseUrl;
  if (!baseUrl) {
    throw configError(
      'profile has no app.baseUrl',
      'add an `app.baseUrl:` to crawl the legacy app',
    );
  }
  const c = profile.crawl ?? {};
  const startUrl = new URL(c.startPath ?? '/', baseUrl).toString();
  const exclude = c.exclude?.length
    ? (url: string) => c.exclude!.some((p) => url.includes(p))
    : undefined;

  let auth: CrawlAppOptions['auth'];
  if (c.auth) {
    const username = profile.env[c.auth.usernameEnv];
    const password = profile.env[c.auth.passwordEnv];
    if (!username || !password) {
      throw configError(
        `crawl credentials not set (${c.auth.usernameEnv} / ${c.auth.passwordEnv})`,
        'set the username/password env vars in your .env',
      );
    }
    auth = {
      url: new URL(c.auth.loginPath, baseUrl).toString(),
      usernameSelector: c.auth.usernameSelector,
      passwordSelector: c.auth.passwordSelector,
      submitSelector: c.auth.submitSelector,
      username,
      password,
      waitForSelector: c.auth.waitForSelector,
    };
  }

  return {
    startUrl,
    auth,
    exclude,
    maxStates: maxStatesOverride ?? c.maxStates,
    viewport: profile.eval?.viewport,
  };
}

export const crawlCommand = defineCommand({
  name: 'crawl',
  group: 'pipeline',
  describe: 'Crawl the running legacy app into a UI state inventory (the CRAWL stage)',
  exitCodes: ['CONFIG', 'NETWORK', 'RUNTIME'],
  options: [{ flags: '--max-states <n>', describe: 'cap distinct screens discovered' }],
  examples: ['loom crawl', 'loom crawl --max-states 100 --json'],
  async run(ctx, input) {
    const profile = ctx.requireProfile();
    const max = input.options.maxStates !== undefined ? Number(input.options.maxStates) : undefined;
    const options = crawlOptionsFrom(profile, max);
    const result = await crawlApp(options);

    // Persist the discovered states into the UI atlas when a data dir is configured.
    let atlasPath: string | undefined;
    if (profile.dataDir) {
      atlasPath = join(profile.dataDir, 'uiatlas.db');
      const atlas = openUiAtlas(atlasPath);
      try {
        atlas.ingest(result.states);
      } finally {
        atlas.close();
      }
    }

    return {
      startUrl: options.startUrl,
      visited: result.visited,
      truncated: result.truncated,
      states: result.states.map((s) => ({ key: s.key, url: s.url, links: s.links.length })),
      ...(atlasPath ? { atlasPath } : {}),
    } satisfies CrawlData;
  },
  render(data, ctx) {
    const d = data as CrawlData;
    ctx.sink.line(
      renderTable(
        d.states.map((s) => ({ key: s.key, url: s.url, links: String(s.links) })),
        [
          { key: 'key', header: 'KEY' },
          { key: 'url', header: 'URL' },
          { key: 'links', header: 'LINKS', align: 'right' },
        ],
      ),
    );
    ctx.sink.line('');
    ctx.sink.line(
      `${d.states.length} screen(s) from ${d.visited} page(s)${d.truncated ? ' (truncated — raise --max-states)' : ''}`,
    );
    if (d.atlasPath) ctx.sink.line(`ingested into ${d.atlasPath}`);
  },
});
