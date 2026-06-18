import type { DomSnapshot } from '@loom/browser';
import { extractLinks } from './links.js';
import { screenKey } from './state-identity.js';

/** Visit a URL and capture its DOM (real browser by default; faked in tests). */
export type VisitFn = (url: string) => Promise<{ dom: DomSnapshot }>;

/** One captured UI state — the unit of the UI atlas. */
export type UiState = {
  key: string;
  url: string;
  framePath?: string;
  dom: DomSnapshot;
  /** Same-origin navigation targets discovered on this state. */
  links: string[];
  /** A PNG of the rendered screen (the visual map / parity baseline), when captured. */
  screenshot?: Buffer;
};

export type UiAtlas = {
  states: UiState[];
};

export type CrawlOptions = {
  startUrl: string;
  visit: VisitFn;
  /** Cap distinct states (default 200) — a hard bound so an autonomous crawl can't run away. */
  maxStates?: number;
  /** Cap total page fetches (default max(maxStates×10, 200)) — bounds data-variant explosions. */
  maxVisits?: number;
  /** Skip URLs (never enqueued) — e.g. destructive `/logout` links. Part of safe crawling. */
  exclude?: (url: string) => boolean;
};

export type CrawlResult = UiAtlas & {
  /** Pages fetched (≥ states; higher when many URLs collapse to one screen). */
  visited: number;
  /** True if a cap stopped the crawl before the frontier drained. */
  truncated: boolean;
};

/**
 * Breadth-first crawl of a running app into a UI atlas. Dedupes by **state key**
 * (so many URLs that render the same screen collapse to one state) and by URL
 * (never re-fetched), and is hard-bounded by `maxStates`. The `visit` seam keeps
 * the BFS/dedup logic testable without a browser; the live crawler supplies a
 * Playwright-backed visit.
 */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const maxStates = options.maxStates ?? 200;
  const maxVisits = options.maxVisits ?? Math.max(maxStates * 10, 200);
  const queuedUrls = new Set<string>([options.startUrl]);
  const seenKeys = new Set<string>();
  const queue: string[] = [options.startUrl];
  const states: UiState[] = [];
  let visited = 0;

  while (queue.length > 0 && states.length < maxStates && visited < maxVisits) {
    const url = queue.shift()!;
    const { dom } = await options.visit(url);
    visited += 1;
    const key = screenKey({ url, dom });
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const links = extractLinks(dom, url);
    states.push({ key, url, dom, links });

    for (const link of links) {
      if (queuedUrls.has(link) || options.exclude?.(link)) continue;
      queuedUrls.add(link);
      queue.push(link);
    }
  }

  return { states, visited, truncated: queue.length > 0 };
}
