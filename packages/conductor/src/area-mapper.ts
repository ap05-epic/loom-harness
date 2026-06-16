import type { ChatMessage, LlmGateway } from '@loom/agents';
import type { AreaMap, MapTarget } from './deep-map.js';

/**
 * The gateway-backed sub-agent for the deep-map swarm: given one target (a screen / action / area)
 * and its slice (the UI-atlas + CodeAtlas context for that target), the model produces a light,
 * structured map — a prose summary, the entities it touches, and its links to other areas. Many of
 * these run in parallel under `deepMap`, all with the SAME instructions. Documentation only: the
 * prompt forbids backend changes (the rebuild is frontend + light docs).
 */

/** The mapping prompt — grounded on the target's slice, strict-JSON, no-backend-change rule. */
export function buildMapPrompt(target: MapTarget, slice: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are a mapping sub-agent documenting one screen of a large legacy app so it can be ' +
        'faithfully rebuilt in a modern frontend. You do NOT change any backend — you document and ' +
        'map. From the screen SLICE (its forms, links, structure, source), produce STRICT JSON only:\n' +
        '{"summary":"a few sentences on what this screen does",' +
        '"entities":["services/forms/tables/data it touches, by name"],' +
        '"links":[{"to":"another screen id","via":"how (menu/button/link)"}]}\n' +
        'Ground every item in the slice — invent nothing. No prose outside the JSON.',
    },
    { role: 'user', content: `Screen ${target.id} (${target.kind ?? 'screen'})\n\n${slice}` },
  ];
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Lenient parse of a sub-agent reply into an AreaMap; junk degrades to an empty map (never throws). */
export function parseAreaMap(content: string | null, target: MapTarget): AreaMap {
  const out: AreaMap = { id: target.id, summary: '', entities: [], links: [] };
  if (!content) return out;
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return out;
  let obj: unknown;
  try {
    obj = JSON.parse(content.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!obj || typeof obj !== 'object') return out;
  const o = obj as Record<string, unknown>;
  if (typeof o.summary === 'string') out.summary = o.summary.trim();
  out.entities = asStringArray(o.entities);
  if (Array.isArray(o.links)) {
    out.links = o.links
      .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
      .filter((l) => typeof l.to === 'string')
      .map((l) => ({ to: l.to as string, ...(typeof l.via === 'string' ? { via: l.via } : {}) }));
  }
  return out;
}

/**
 * Build a `mapTarget` for `deepMap`: ask the model to map each target using its per-target slice
 * (supplied by `sliceFor`, which reads the atlases). The same instructions for every sub-agent.
 */
export function llmAreaMapper(
  gateway: LlmGateway,
  model: string,
  sliceFor: (target: MapTarget) => string,
): (target: MapTarget, index: number) => Promise<AreaMap> {
  return async (target) => {
    const res = await gateway.complete({
      model,
      messages: buildMapPrompt(target, sliceFor(target)),
    });
    return parseAreaMap(res.content, target);
  };
}
