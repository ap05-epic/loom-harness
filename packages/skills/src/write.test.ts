import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadSkillDir, parseSkillMd, writeSkillFile } from './index.js';

describe('writeSkillFile', () => {
  test('writes <dir>/<name>/SKILL.md that round-trips and loads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-write-'));
    const doc = { name: 'convert-x', description: 'does x', triggers: ['a'], body: 'Step.' };

    const path = writeSkillFile(dir, doc);

    expect(path).toBe(join(dir, 'convert-x', 'SKILL.md'));
    expect(parseSkillMd(readFileSync(path, 'utf8'))).toEqual(doc);
    expect(loadSkillDir(dir).map((d) => d.name)).toEqual(['convert-x']);
  });
});
