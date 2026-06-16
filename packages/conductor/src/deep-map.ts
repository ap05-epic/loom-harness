import { mapPool } from './workers/pool.js';

/**
 * The deep-map swarm: fan out many **same-instruction** sub-agents over the worker pool to map an
 * app too large for one context — each maps one target (a screen / action / area) into a light,
 * structured contribution, and the results aggregate into a deduped picture of the whole. This is
 * the reusable engine behind "summon sub-agents to map the infrastructure"; the per-target mapper
 * is injected (an LLM-backed sub-agent in production, a fake in tests), so the orchestration is
 * deterministic and project-agnostic. Documentation/understanding only — it changes no source.
 */

/** One unit to map — a screen, an action, an area of the app. */
export type MapTarget = { id: string; kind?: string; hint?: string };

/** A sub-agent's structured contribution for one target. */
export type AreaMap = {
  id: string;
  /** A light prose summary of what this area does (no backend changes — documentation only). */
  summary: string;
  /** Entities/data this area touches — form, service, table, stored-proc names. */
  entities: string[];
  /** Connections to other areas (navigation, data flow). */
  links: Array<{ to: string; via?: string }>;
};

export type DeepMapResult = {
  areas: AreaMap[];
  /** Deduped union of every entity discovered across the swarm. */
  entities: string[];
  /** Every connection, flattened with its source area. */
  connections: Array<{ from: string; to: string; via?: string }>;
  /** Targets actually mapped (≤ requested when a budget caps it). */
  mapped: number;
  truncated: boolean;
};

export type DeepMapOptions = {
  targets: MapTarget[];
  /** The per-target sub-agent — same instructions for all; injected (LLM-backed in production). */
  mapTarget: (target: MapTarget, index: number) => Promise<AreaMap>;
  /** Max sub-agents in flight (default 4). */
  concurrency?: number;
  /** Cap targets mapped — the budget for a huge app. */
  maxTargets?: number;
  /** Called as each area completes (persist to the atlas / worklog, update Mission Control). */
  onArea?: (area: AreaMap) => void;
};

/**
 * Run the swarm and aggregate. Targets beyond `maxTargets` are dropped (flagged `truncated`); the
 * pool bounds how many sub-agents run at once; entities are deduped across all contributions.
 */
export async function deepMap(opts: DeepMapOptions): Promise<DeepMapResult> {
  const slice = opts.targets.slice(0, opts.maxTargets ?? opts.targets.length);
  const truncated = slice.length < opts.targets.length;

  const areas = await mapPool(slice, opts.concurrency ?? 4, async (target, index) => {
    const area = await opts.mapTarget(target, index);
    opts.onArea?.(area);
    return area;
  });

  const entities = new Set<string>();
  const connections: Array<{ from: string; to: string; via?: string }> = [];
  for (const area of areas) {
    for (const e of area.entities) entities.add(e);
    for (const link of area.links) connections.push({ from: area.id, to: link.to, via: link.via });
  }

  return { areas, entities: [...entities], connections, mapped: areas.length, truncated };
}
