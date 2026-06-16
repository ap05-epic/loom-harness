/**
 * Run `fn` over `items` with at most `concurrency` calls in flight at once,
 * returning results in input order. The bounded primitive the conductor uses to
 * build N screens concurrently without saturating the model endpoint.
 *
 * A rejecting task rejects the pool — the per-screen FIX loop catches its own
 * failures, so a rejection here is a real fault that should surface.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
