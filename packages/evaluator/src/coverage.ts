export type CoverageInput = {
  /** Screen keys the MAP found — the static inventory (ground truth). */
  planned: string[];
  /** Screen keys the crawler actually reached (runtime). */
  crawled: string[];
  /** Screen keys with a passed rebuild. */
  built: string[];
};

export type CoverageReport = {
  /** Distinct screens discovered (union of planned + crawled). */
  total: number;
  /** Discovered screens that have a passed build. */
  built: number;
  /** built / total, as a percentage (100 for an empty run). */
  coveragePct: number;
  /** True when every discovered screen is built. */
  complete: boolean;
  /** Planned (static) screens the crawler never reached — a crawl gap. */
  missingFromCrawl: string[];
  /** Crawled screens not in the static plan — runtime-only (need work packages). */
  unplanned: string[];
  /** Discovered screens without a passed build — these block the ship gate. */
  notBuilt: string[];
};

const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

/**
 * The coverage ledger — the "no screen left behind" guarantee. It reconciles the
 * MAP's static inventory, what the crawler actually reached, and what's been
 * rebuilt, and flags every gap: a static screen the crawl missed, a runtime-only
 * screen with no plan, and any discovered screen not yet built. `notBuilt` must
 * be empty before the ship gate opens.
 */
export function coverageLedger(input: CoverageInput): CoverageReport {
  const planned = new Set(input.planned);
  const crawled = new Set(input.crawled);
  const built = new Set(input.built);
  const discovered = new Set<string>([...planned, ...crawled]);

  const builtDiscovered = [...discovered].filter((s) => built.has(s));
  const total = discovered.size;
  const coveragePct = total === 0 ? 100 : Math.round((builtDiscovered.length / total) * 100);

  return {
    total,
    built: builtDiscovered.length,
    coveragePct,
    complete: builtDiscovered.length === total,
    missingFromCrawl: sortedUnique([...planned].filter((s) => !crawled.has(s))),
    unplanned: sortedUnique([...crawled].filter((s) => !planned.has(s))),
    notBuilt: sortedUnique([...discovered].filter((s) => !built.has(s))),
  };
}
