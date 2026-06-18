/** One point on the live token-burn line: cumulative tokens at a given elapsed time. */
export type TokenSample = { elapsedMs: number; tokens: number };

const MAX_SAMPLES = 240;

/**
 * Append the latest crawl total to the burn series, accumulated client-side across polls (the
 * server only reports the running total, not a history). Exact duplicates are skipped (re-polling
 * the same state shouldn't flat-line the chart), and the series is capped to the most recent points.
 */
export function appendSample(
  series: TokenSample[],
  point: TokenSample,
  max: number = MAX_SAMPLES,
): TokenSample[] {
  const last = series[series.length - 1];
  if (last && last.elapsedMs === point.elapsedMs && last.tokens === point.tokens) return series;
  const next = [...series, point];
  return next.length > max ? next.slice(next.length - max) : next;
}
