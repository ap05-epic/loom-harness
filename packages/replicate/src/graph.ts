import type { CodeAtlas } from '@loom/cartographer';
import { legacyNavTargets, normalizePath } from './paths.js';

/** One screen in the navigation tree + where it leads. */
export type NavNode = {
  /** Screen key (e.g. `loginAction`). */
  key: string;
  /** The Struts action path (e.g. `/loginAction`). */
  actionPath: string;
  /** View JSP(s) the screen renders. */
  views: string[];
  /** Keys of the screens this one navigates to (links/forms/forwards, resolved + deduped). */
  to: string[];
  /** Normalized targets that don't map to a known screen (external/unmapped) — reported, not edges. */
  toUnresolved: string[];
};

/** The whole app's navigation graph, derived from the static map (CodeAtlas) — the tree of user paths. */
export type NavTree = { nodes: NavNode[]; screenCount: number; edgeCount: number };

/**
 * Build the navigation tree from the static map: every screen → the screens it links/submits/forwards
 * to. This is the "tree of all user paths" — already complete in the atlas (parsed from struts-config),
 * no crawling needed. Targets are resolved to screen keys by their action path; anything that doesn't
 * map to a known screen is surfaced under `toUnresolved`. Deterministic, no LLM.
 */
export function buildNavTree(atlas: CodeAtlas): NavTree {
  const screens = atlas.screens();
  // normalized action route → screen key, so we can resolve a link target back to the screen it hits.
  const byRoute = new Map<string, string>();
  for (const s of screens) {
    const r = normalizePath(s.actionPath);
    if (r) byRoute.set(r, s.key);
  }
  const nodes: NavNode[] = [];
  let edgeCount = 0;
  for (const s of screens) {
    const to = new Set<string>();
    const toUnresolved = new Set<string>();
    for (const target of legacyNavTargets(atlas, s.key)) {
      const r = normalizePath(target);
      if (!r) continue;
      const hit = byRoute.get(r);
      if (hit) to.add(hit);
      else toUnresolved.add(r);
    }
    edgeCount += to.size + toUnresolved.size;
    nodes.push({
      key: s.key,
      actionPath: s.actionPath,
      views: s.viewJsps,
      to: [...to].sort(),
      toUnresolved: [...toUnresolved].sort(),
    });
  }
  return { nodes, screenCount: screens.length, edgeCount };
}

/** Render the nav tree as a readable terminal listing. */
export function printNavTree(tree: NavTree): string {
  const lines = [`Navigation tree — ${tree.screenCount} screen(s), ${tree.edgeCount} edge(s)\n`];
  for (const n of tree.nodes) {
    lines.push(`${n.key}  (${n.actionPath})`);
    for (const t of n.to) lines.push(`   → ${t}`);
    for (const u of n.toUnresolved) lines.push(`   → ${u}  (external/unmapped)`);
  }
  return lines.join('\n');
}

/** Render the nav tree as Graphviz DOT (resolved edges solid, unmapped dashed) for visual viewing. */
export function navTreeToDot(tree: NavTree): string {
  const lines = ['digraph nav {', '  rankdir=LR;', '  node [shape=box];'];
  for (const n of tree.nodes) {
    for (const t of n.to) lines.push(`  "${n.key}" -> "${t}";`);
    for (const u of n.toUnresolved) lines.push(`  "${n.key}" -> "${u}" [style=dashed];`);
  }
  lines.push('}');
  return lines.join('\n');
}
