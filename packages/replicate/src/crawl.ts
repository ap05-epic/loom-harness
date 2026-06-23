import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CrawlSession, type Viewport } from '@loom/browser';
import { domSignature, screenKey } from '@loom/surveyor';
import type { CrawlStore } from './crawl-db.js';
import { buildWorkList, correlateProvenance, DEFAULT_DENY, redactBody } from './crawl-guard.js';
import {
  enterFaGateway,
  flattenText,
  loginInSession,
  looksLikeFailure,
  type FaGateway,
  type LoginConfig,
} from './login.js';
import { extractNavigation } from './nav.js';

export type CrawlOptions = {
  login: LoginConfig;
  /** Post-login path to start from (else the landing page). */
  startPath?: string;
  /** The FA gateway — when set, a second crawl phase maps the FA-selected (data) state. */
  fa?: FaGateway;
  /** Click JS-overlay actions too (default false: record them, don't follow — they can wedge). */
  followJs?: boolean;
  deny?: RegExp;
  loadMs?: number;
  maxStates?: number;
  maxActions?: number;
  maxDepth?: number;
  store: CrawlStore;
  shotsDir: string;
  viewport?: Viewport;
  /** Secrets to redact in logs (the store redacts what it persists). */
  secrets: string[];
  onLog?: (m: string) => void;
};

export type CrawlSummary = {
  states: number;
  interactions: number;
  endpoints: number;
  provenance: number;
  truncated: boolean;
};

const DATA_TYPES = ['xhr', 'fetch', 'document'];

/**
 * Exhaustive, deterministic runtime crawl of a legacy app: log in once, click EVERY candidate across
 * the live app (record‑only for destructive/JS), in two FA phases, recording all state→state user
 * paths + each screen's data endpoints/payloads + the value→endpoint provenance into the crawl DB.
 * No LLM. Resumable. The FA is redacted everywhere persisted (store‑side) and in logs.
 */
export async function runCrawl(opts: CrawlOptions): Promise<CrawlSummary> {
  const log = opts.onLog ?? (() => {});
  const redactLog = (m: string): void => log(redactBody(m, opts.secrets));
  const deny = opts.deny ?? DEFAULT_DENY;
  const loadMs = opts.loadMs ?? 15000;
  const maxStates = opts.maxStates ?? 400;
  const maxActions = opts.maxActions ?? 4000;
  const maxDepth = opts.maxDepth ?? 25;
  const store = opts.store;
  const counters = { states: 0, actions: 0, endpoints: 0, provenance: 0 };
  let truncated = false;

  mkdirSync(opts.shotsDir, { recursive: true });
  const visited = store.seenStateKeys(); // RESUME: states already mapped across runs
  const runId = store.startRun({
    startUrl: opts.login.loginUrl,
    budgets: { maxStates, maxActions, maxDepth },
  });
  const session = new CrawlSession({ viewport: opts.viewport, captureBodies: true });
  await session.open();
  try {
    await loginInSession(session, opts.login, redactLog);
    session.startNetworkLog();

    const keyHere = async (): Promise<{ key: string; url: string }> => {
      const url = session.currentUrl();
      const dom = await session.captureCombined();
      return { key: screenKey({ url, dom }), url };
    };

    /** Capture the current screen (state + endpoints + provenance on first visit). */
    const visit = async (
      tag: string,
    ): Promise<{ id: number; key: string; url: string; isNew: boolean }> => {
      await session.awaitStable(loadMs);
      const dom = await session.captureCombined();
      const url = session.currentUrl();
      const key = screenKey({ url, dom });
      const composite = `${key}::${tag}`;
      const isNew = !visited.has(composite);
      const net = session.drainNetworkLog();

      let shotPath: string | undefined;
      try {
        const file = join(opts.shotsDir, `${key}.${tag.replace(/:/g, '_')}.png`);
        writeFileSync(file, await session.screenshot(true));
        shotPath = file;
      } catch {
        /* screenshot best-effort */
      }
      const sid = store.upsertState({
        key,
        url,
        domSignature: domSignature(dom),
        stateTag: tag,
        screenshotPath: shotPath,
      });

      if (isNew) {
        counters.states++;
        // endpoints keyed by RAW url (in memory) so provenance correlation lines up; store redacts.
        const epIdByUrl = new Map<string, number>();
        const seenEp = new Set<string>();
        for (const ep of net) {
          if (!DATA_TYPES.includes(ep.resourceType)) continue;
          const k = `${ep.method} ${ep.url}`;
          if (seenEp.has(k)) continue;
          seenEp.add(k);
          const epId = store.recordEndpoint({
            stateId: sid,
            method: ep.method,
            url: ep.url,
            resourceType: ep.resourceType,
            status: ep.status,
            body: ep.responseBody,
          });
          epIdByUrl.set(ep.url, epId);
          counters.endpoints++;
        }
        for (const p of correlateProvenance(dom, net)) {
          store.recordProvenance({
            stateId: sid,
            value: p.value,
            endpointId: epIdByUrl.get(p.endpointUrl),
            label: p.label,
            meta: { where: p.where },
          });
          counters.provenance++;
        }
        redactLog(`  ＋ ${key} [${tag}] · ${epIdByUrl.size} endpoint(s)`);
      }
      visited.add(composite);
      return { id: sid, key, url, isNew };
    };

    /** POST‑safe backtrack to a state: goBack → re‑navigate → re‑login(+FA) → give up on this branch. */
    const returnTo = async (target: {
      key: string;
      url: string;
      tag: string;
    }): Promise<boolean> => {
      if (await session.goBack()) {
        await session.awaitStable(loadMs);
        if ((await keyHere()).key === target.key) return true;
      }
      try {
        await session.navigate(target.url);
        await session.awaitStable(loadMs);
        const dom = await session.captureCombined();
        if (
          !looksLikeFailure(flattenText(dom)) &&
          screenKey({ url: session.currentUrl(), dom }) === target.key
        )
          return true;
      } catch {
        /* re-nav failed */
      }
      try {
        await loginInSession(session, opts.login, redactLog);
        if (target.tag.startsWith('fa:') && opts.fa)
          await enterFaGateway(session, opts.fa, redactLog);
        await session.navigate(target.url).catch(() => undefined);
        await session.awaitStable(loadMs);
        if ((await keyHere()).key === target.key) return true;
      } catch {
        /* heavy recovery failed → abort this branch, keep all partial data */
      }
      return false;
    };

    /** Exhaustive DFS from the current screen, tagging every state with `tag`. */
    const crawlPhase = async (tag: string): Promise<void> => {
      const root = await visit(tag);
      const stack: Array<{ id: number; key: string; url: string }> = [root];
      while (stack.length > 0) {
        if (counters.states >= maxStates || counters.actions >= maxActions) {
          truncated = true;
          break;
        }
        const cur = stack[stack.length - 1]!;
        const cands = await session.enumerateCandidates();
        const navlinks = extractNavigation(await session.captureCombined());
        const work = buildWorkList({ candidates: cands, navlinks, deny, followJs: opts.followJs });
        const tried = store.triedSigs(cur.id);
        const item = work.find((w) => !tried.has(w.sig));
        if (!item) {
          stack.pop();
          if (stack.length > 0) await returnTo({ ...stack[stack.length - 1]!, tag });
          continue;
        }
        const recordOnly = item.isDestructive || (item.isJs && !opts.followJs);
        const interId = store.recordInteraction({
          fromStateId: cur.id,
          actionKind: item.isTextbox ? 'fill' : item.ref ? 'click' : 'nav',
          actionTarget: item.target,
          label: item.label,
          kind: item.kind,
          isDestructive: item.isDestructive,
          followed: !recordOnly,
          sig: item.sig,
        });
        if (recordOnly) continue; // map the path, never click it
        counters.actions++;
        if (item.isTextbox) {
          await session.fillCandidate(item.ref!, 'loom').catch(() => undefined); // deterministic, never a secret
          continue;
        }
        try {
          if (item.ref) await session.clickCandidate(item.ref);
          else if (item.target) await session.navigate(item.target);
          else continue;
        } catch {
          await returnTo({ ...cur, tag });
          continue;
        }
        const landed = await visit(tag);
        store.patchInteractionTo(interId, landed.id, landed.isNew);
        if (landed.isNew && stack.length < maxDepth && landed.key !== cur.key) {
          stack.push({ id: landed.id, key: landed.key, url: landed.url });
        } else {
          await returnTo({ ...cur, tag });
        }
      }
    };

    // PHASE 1 — no-FA
    if (opts.startPath) await session.navigate(opts.startPath);
    redactLog('  ◆ phase: no-fa');
    await crawlPhase('no-fa');

    // PHASE 2 — FA-selected
    if (opts.fa && !truncated) {
      redactLog('  ◆ phase: entering FA gateway…');
      if (await enterFaGateway(session, opts.fa, redactLog)) {
        const tag = `fa:${createHash('sha256').update(opts.fa.value).digest('hex').slice(0, 8)}`;
        await crawlPhase(tag);
      } else {
        redactLog('  ⚠ FA box not found — mapped the no-FA state only (tune --fa-hint)');
      }
    }

    store.finishRun(runId, truncated ? 'aborted' : 'done');
    return {
      states: counters.states,
      interactions: counters.actions,
      endpoints: counters.endpoints,
      provenance: counters.provenance,
      truncated,
    };
  } finally {
    await session.close();
  }
}
