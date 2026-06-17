import { join } from 'node:path';
import type { Profile } from '@loom/core';
import { llmChooser } from '@loom/conductor';
import { exploreApp, openUiAtlas, type ExploreAppOptions, type ExploreStep } from '@loom/surveyor';
import { configError } from '../../errors.js';
import { gatewayFromProfile } from '../../pipeline-config.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';

type ExploreData = {
  startUrl: string;
  visited: number;
  truncated: boolean;
  states: Array<{ key: string; url: string; links: number }>;
  /** Where the discovered states were persisted (the UI atlas), if a data dir is set. */
  atlasPath?: string;
};

/**
 * Build the AI-explorer's options from the profile. Secrets (login + FA code) are read from env by
 * the NAMES in `crawl.auth` / `crawl.faEnv`, handed only to the driver for substitution, and never
 * reach the model's prompt. The LLM chooser (gpt-5.4) decides what to type and click.
 */
export function exploreOptionsFrom(
  profile: Profile,
  maxStatesOverride?: number,
): ExploreAppOptions {
  const baseUrl = profile.app?.baseUrl;
  if (!baseUrl) {
    throw configError(
      'profile has no app.baseUrl',
      'add an `app.baseUrl:` to explore the legacy app',
    );
  }
  const c = profile.crawl ?? {};
  const startUrl = new URL(c.startPath ?? '/', baseUrl).toString();

  // $user / $pass / $fa — values resolved from env here, substituted in the driver, never prompted.
  const secrets: Record<string, string> = {};
  if (c.auth) {
    const user = profile.env[c.auth.usernameEnv];
    const pass = profile.env[c.auth.passwordEnv];
    if (!user || !pass) {
      throw configError(
        `explore credentials not set (${c.auth.usernameEnv} / ${c.auth.passwordEnv})`,
        'set the username/password env vars in your .env',
      );
    }
    secrets.user = user;
    secrets.pass = pass;
  }
  const fa = profile.env[c.faEnv ?? 'fa_numbers'];
  if (fa) secrets.fa = fa;

  return {
    startUrl,
    secrets,
    chooser: llmChooser(gatewayFromProfile(profile), profile.llm.model, Object.keys(secrets)),
    storageStatePath: profile.app?.storageStatePath,
    cookiesPath: profile.app?.cookiesPath,
    // Legacy homes (BAA) load their menu via AJAX after settle — wait for controls by default.
    hydrateMs: c.hydrateMs ?? 12_000,
    maxStates: maxStatesOverride ?? c.maxStates,
    viewport: profile.eval?.viewport,
  };
}

/** A one-line, human-readable description of a step — secrets stay as their `$name` placeholder. */
function describeStep(s: ExploreStep): string {
  const target = s.label ? `"${s.label}"` : s.action.ref;
  const what =
    s.action.kind === 'fill' ? `typed ${s.action.value} into ${target}` : `clicked ${target}`;
  return s.isNew ? `${what} → new screen (${s.discovered})` : what;
}

export const exploreCommand = defineCommand({
  name: 'explore',
  group: 'pipeline',
  describe: 'Let the model drive the legacy app itself (login, FA search, walk) into the UI atlas',
  exitCodes: ['CONFIG', 'NETWORK', 'RUNTIME'],
  options: [{ flags: '--max-states <n>', describe: 'cap distinct screens discovered' }],
  examples: ['loom explore', 'loom explore --max-states 3 --json'],
  async run(ctx, input) {
    const profile = ctx.requireProfile();
    const max = input.options.maxStates !== undefined ? Number(input.options.maxStates) : undefined;
    const options = exploreOptionsFrom(profile, max);
    options.onStep = (s) => ctx.sink.info(describeStep(s)); // live progress to stderr
    const result = await exploreApp(options);

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
    } satisfies ExploreData;
  },
  render(data, ctx) {
    const d = data as ExploreData;
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
      `${d.states.length} screen(s) from ${d.visited} action(s)${d.truncated ? ' (truncated — raise --max-states)' : ''}`,
    );
    if (d.atlasPath) ctx.sink.line(`ingested into ${d.atlasPath}`);
  },
});
