import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { parseSkillMd, type SkillDoc } from './skill-md.js';

/** Recursively collect every `SKILL.md` path under `dir` (a missing dir → none). */
function findSkillFiles(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findSkillFiles(full));
    else if (entry.name === 'SKILL.md') out.push(full);
  }
  return out;
}

/**
 * Load every `SKILL.md` under a directory (recursively) into parsed SkillDocs,
 * sorted by name. Best-effort: a malformed file is skipped, not fatal, so one
 * bad skill never breaks the library.
 */
export function loadSkillDir(dir: string): SkillDoc[] {
  const docs: SkillDoc[] = [];
  for (const file of findSkillFiles(dir)) {
    try {
      docs.push(parseSkillMd(readFileSync(file, 'utf8')));
    } catch {
      // skip a malformed SKILL.md
    }
  }
  return docs.sort((a, b) => a.name.localeCompare(b.name));
}
