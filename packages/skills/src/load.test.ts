import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadSkillDir } from './index.js';

function skillDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  for (const [name, desc] of [
    ['alpha', 'does alpha'],
    ['beta', 'does beta'],
  ]) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(
      join(dir, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${desc}\n---\nBody of ${name}.`,
    );
  }
  return dir;
}

describe('loadSkillDir', () => {
  test('loads and parses every SKILL.md under the directory', () => {
    const docs = loadSkillDir(skillDir());
    expect(docs.map((d) => d.name)).toEqual(['alpha', 'beta']);
    expect(docs[0]!.body).toContain('Body of alpha.');
  });

  test('returns [] for a missing or empty directory', () => {
    expect(loadSkillDir(join(tmpdir(), 'does-not-exist-loom'))).toEqual([]);
    expect(loadSkillDir(mkdtempSync(join(tmpdir(), 'empty-')))).toEqual([]);
  });

  test('skips a malformed SKILL.md instead of throwing', () => {
    const dir = skillDir();
    mkdirSync(join(dir, 'broken'), { recursive: true });
    writeFileSync(join(dir, 'broken', 'SKILL.md'), 'no frontmatter here');
    expect(loadSkillDir(dir).map((d) => d.name)).toEqual(['alpha', 'beta']);
  });
});
