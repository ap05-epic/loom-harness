import { mapPool } from './pool.js';

export type DepNode<T> = { id: string; deps: string[]; item: T };
export type DepStatus = 'done' | 'blocked' | 'failed';
export type DepResult<R> = { id: string; status: DepStatus; result?: R; error?: Error };

function assertValid<T>(nodes: DepNode<T>[], byId: Map<string, DepNode<T>>): void {
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!byId.has(d)) throw new Error(`unknown dependency: ${d} (required by ${n.id})`);
    }
  }
  // DFS cycle detection (0 = unvisited, 1 = on the stack, 2 = done)
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): void => {
    const s = state.get(id) ?? 0;
    if (s === 2) return;
    if (s === 1) throw new Error(`dependency cycle involving ${id}`);
    state.set(id, 1);
    for (const d of byId.get(id)!.deps) visit(d);
    state.set(id, 2);
  };
  for (const n of nodes) visit(n.id);
}

/**
 * Run a dependency graph of work with bounded concurrency: a node runs only
 * after all its deps are `done`, independent nodes run in parallel (up to
 * `concurrency`), and a node whose dep failed (or was itself blocked) is
 * `blocked` and never runs — the conductor's "shared components first, then the
 * screens that depend on them, and never thrash a doomed branch" policy.
 * Unknown deps and cycles are rejected up front. Results are keyed by node id.
 */
export async function runWithDeps<T, R>(
  nodes: DepNode<T>[],
  concurrency: number,
  fn: (item: T, id: string) => Promise<R>,
): Promise<Map<string, DepResult<R>>> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assertValid(nodes, byId);

  const results = new Map<string, DepResult<R>>();
  let remaining = [...nodes];

  while (remaining.length > 0) {
    const ready = remaining.filter((n) => n.deps.every((d) => results.has(d)));
    if (ready.length === 0) break; // unreachable once cycles are rejected
    const runnable = ready.filter((n) => n.deps.every((d) => results.get(d)!.status === 'done'));
    const runnableIds = new Set(runnable.map((n) => n.id));
    for (const n of ready) {
      if (!runnableIds.has(n.id)) results.set(n.id, { id: n.id, status: 'blocked' });
    }
    await mapPool(runnable, concurrency, async (n) => {
      try {
        const result = await fn(n.item, n.id);
        results.set(n.id, { id: n.id, status: 'done', result });
      } catch (error) {
        results.set(n.id, {
          id: n.id,
          status: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    });
    remaining = remaining.filter((n) => !results.has(n.id));
  }
  return results;
}
