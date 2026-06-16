import { describe, expect, test } from 'vitest';
import { parseSkillMd, skillCatalog, skillEntry } from './index.js';

const A = parseSkillMd(
  '---\nname: a-skill\ndescription: does A\ntriggers: [x]\n---\nStep 1 for A.',
);
const B = parseSkillMd('---\nname: b-skill\ndescription: does B\n---\nStep 1 for B.');

describe('progressive disclosure', () => {
  test('skillCatalog lists name + description only (Level 0, cheap)', () => {
    const cat = skillCatalog([A, B]);
    expect(cat).toContain('a-skill: does A');
    expect(cat).toContain('b-skill: does B');
    expect(cat).not.toContain('Step 1'); // the body is not disclosed at Level 0
  });

  test('skillEntry renders the full skill (Level 1)', () => {
    const e = skillEntry(A);
    expect(e).toContain('a-skill');
    expect(e).toContain('does A');
    expect(e).toContain('Step 1 for A.');
  });

  test('skillCatalog of an empty list is empty', () => {
    expect(skillCatalog([])).toBe('');
  });
});
