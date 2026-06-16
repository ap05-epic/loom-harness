import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeSkillMd, type SkillDoc } from './skill-md.js';

/**
 * Persist a skill to `<dir>/<name>/SKILL.md` (creating the directory) — the way
 * the Reflector records a drafted skill as a file. Returns the written path.
 */
export function writeSkillFile(dir: string, doc: SkillDoc): string {
  const skillDir = join(dir, doc.name);
  mkdirSync(skillDir, { recursive: true });
  const path = join(skillDir, 'SKILL.md');
  writeFileSync(path, serializeSkillMd(doc), 'utf8');
  return path;
}
