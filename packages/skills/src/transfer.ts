import { loadSkillDir } from './load.js';
import { writeSkillFile } from './write.js';

/**
 * Copy every `SKILL.md` under `from` into `<to>/<name>/SKILL.md`, re-serializing
 * each through the parser so the output is normalized, valid SKILL.md. Because our
 * SKILL.md *is* the agentskills.io / DIGIT format, this is exactly what `skills
 * export --target digit` (and `skills import`) need — a format-faithful round-trip.
 * Best-effort: a malformed source file is skipped, never fatal. Returns the names
 * copied (sorted), so the caller can report what moved.
 */
export function copySkillDir(from: string, to: string): string[] {
  const docs = loadSkillDir(from);
  for (const doc of docs) writeSkillFile(to, doc);
  return docs.map((doc) => doc.name);
}
