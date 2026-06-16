import type { SkillDoc } from './skill-md.js';

/**
 * Rank file-based skills against work-order terms — the bundled-library
 * counterpart of `SkillStore.recall`. A term scores 2 when it overlaps a trigger
 * and 1 when it appears in the name/description; skills with no overlap are
 * dropped. Returns the top `limit`, most-relevant first.
 */
export function rankSkillDocs(docs: SkillDoc[], terms: string[], limit = 6): SkillDoc[] {
  const want = terms.map((t) => t.toLowerCase()).filter(Boolean);
  const score = (d: SkillDoc): number => {
    const triggers = d.triggers.map((t) => t.toLowerCase());
    const hay = `${d.name} ${d.description}`.toLowerCase();
    let s = 0;
    for (const t of want) {
      if (triggers.some((g) => g.includes(t) || t.includes(g))) s += 2;
      else if (hay.includes(t)) s += 1;
    }
    return s;
  };
  return docs
    .map((d) => ({ d, s: score(d) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.d);
}
