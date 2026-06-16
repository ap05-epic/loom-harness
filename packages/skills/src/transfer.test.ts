import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { copySkillDir, loadSkillDir, writeSkillFile } from './index.js';

describe('copySkillDir', () => {
  test('copies every SKILL.md into <to>/<name>/SKILL.md and round-trips (DIGIT format)', () => {
    const from = mkdtempSync(join(tmpdir(), 'skill-from-'));
    const to = mkdtempSync(join(tmpdir(), 'skill-to-'));
    writeSkillFile(from, { name: 'b-skill', description: 'b', triggers: ['x'], body: 'B.' });
    writeSkillFile(from, { name: 'a-skill', description: 'a', triggers: [], body: 'A.' });

    const names = copySkillDir(from, to);

    expect(names).toEqual(['a-skill', 'b-skill']); // returned sorted
    // The copied directory loads back to identical docs — our SKILL.md *is* the DIGIT format.
    expect(loadSkillDir(to)).toEqual(loadSkillDir(from));
  });

  test('skips a malformed SKILL.md (best-effort, never fatal)', () => {
    const from = mkdtempSync(join(tmpdir(), 'skill-from-bad-'));
    const to = mkdtempSync(join(tmpdir(), 'skill-to-bad-'));
    writeSkillFile(from, { name: 'good', description: 'g', triggers: [], body: 'G.' });
    mkdirSync(join(from, 'broken'), { recursive: true });
    writeFileSync(join(from, 'broken', 'SKILL.md'), 'no frontmatter here');

    expect(copySkillDir(from, to)).toEqual(['good']);
  });

  test('a missing source directory copies nothing', () => {
    const to = mkdtempSync(join(tmpdir(), 'skill-to-empty-'));
    expect(copySkillDir(join(tmpdir(), 'definitely-not-here-xyz'), to)).toEqual([]);
  });
});
