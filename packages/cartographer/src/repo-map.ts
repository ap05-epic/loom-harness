import { screenKeyFromAction, type CaNode, type CodeAtlas } from './codeatlas.js';

export type RepoMapOptions = {
  project: string;
  /** PageRank damping factor (default 0.85). */
  damping?: number;
  /** PageRank iterations (default 40). */
  iterations?: number;
};

type JspMeta = {
  forms?: { action: string; fields: { property: string }[] }[];
};

/**
 * Graph-ranked importance of every node — the standard PageRank used to order
 * the repo-map so a token-bounded overview leads with the most-connected screens.
 */
function pageRank(
  nodeIds: number[],
  edges: { src: number; dst: number }[],
  damping: number,
  iterations: number,
): Map<number, number> {
  const n = nodeIds.length || 1;
  const outDeg = new Map<number, number>(nodeIds.map((id) => [id, 0]));
  const inbound = new Map<number, number[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) {
    if (!outDeg.has(e.src) || !inbound.has(e.dst)) continue;
    outDeg.set(e.src, outDeg.get(e.src)! + 1);
    inbound.get(e.dst)!.push(e.src);
  }
  let rank = new Map<number, number>(nodeIds.map((id) => [id, 1 / n]));
  for (let i = 0; i < iterations; i++) {
    let dangling = 0;
    for (const id of nodeIds) if (outDeg.get(id) === 0) dangling += rank.get(id)!;
    const next = new Map<number, number>();
    for (const id of nodeIds) {
      let sum = 0;
      for (const src of inbound.get(id)!) sum += rank.get(src)! / outDeg.get(src)!;
      next.set(id, (1 - damping) / n + damping * (sum + dangling / n));
    }
    rank = next;
  }
  return rank;
}

function screenLine(atlas: CodeAtlas, action: CaNode): string {
  const key = screenKeyFromAction(action.name);
  const meta = action.meta as { type?: string | null };
  const views = atlas.linked(action.id, 'renders');
  const jspNames = views.map((v) => v.name);

  const forms: string[] = [];
  for (const view of views) {
    for (const form of (view.meta as JspMeta).forms ?? []) {
      const fields = form.fields.map((f) => f.property).join(', ');
      forms.push(fields ? `${form.action}(${fields})` : form.action);
    }
  }

  const links = new Set<string>();
  for (const view of views) {
    for (const target of atlas.linked(view.id, 'links_to')) links.add(target.name);
  }

  const parts = [`- ${key}  ${action.name}`];
  if (meta.type) parts.push(`[${meta.type}]`);
  if (action.doc) parts.push(`\n    ${action.doc}`);
  if (jspNames.length) parts.push(`\n    views: ${jspNames.join(', ')}`);
  if (forms.length) parts.push(`\n    forms: ${forms.join('; ')}`);
  if (links.size) parts.push(`\n    nav: ${[...links].sort().join(', ')}`);
  return parts.join(' ').replace(/ \n/g, '\n');
}

/**
 * A compact, graph-ranked overview of the whole legacy webapp — the "repo-map"
 * tier of the context oracle. Names every screen with its action, view JSPs,
 * forms, and navigation, ordered by PageRank so a budgeted slice keeps the most
 * important screens. Cheap enough (~thousands of tokens) to hand an agent whole.
 */
export function repoMap(atlas: CodeAtlas, options: RepoMapOptions): string {
  const nodes = atlas.allNodes();
  const edges = atlas.allEdges();
  const rank = pageRank(
    nodes.map((n) => n.id),
    edges,
    options.damping ?? 0.85,
    options.iterations ?? 40,
  );

  const actions = nodes.filter((n) => n.kind === 'action');
  actions.sort((a, b) => rank.get(b.id)! - rank.get(a.id)! || a.name.localeCompare(b.name));

  const tiles = nodes.filter((n) => n.kind === 'tile_def');
  const jsps = nodes.filter((n) => n.kind === 'jsp');

  const lines = [
    `# ${options.project} — code map`,
    '',
    `${actions.length} screens · ${jsps.length} JSPs · ${tiles.length} tile layouts`,
    '',
    '## Screens (by importance)',
    ...actions.map((a) => screenLine(atlas, a)),
  ];

  if (tiles.length) {
    lines.push('', '## Layout');
    for (const tile of tiles) {
      const meta = tile.meta as { path?: string | null; extends?: string | null };
      const renders = atlas.linked(tile.id, 'renders').map((n) => n.name);
      const detail = [meta.path, meta.extends ? `extends ${meta.extends}` : '']
        .filter(Boolean)
        .join(' ');
      lines.push(
        `- ${tile.name}${detail ? `  ${detail}` : ''}${renders.length ? `  → ${renders.join(', ')}` : ''}`,
      );
    }
  }

  return lines.join('\n') + '\n';
}
