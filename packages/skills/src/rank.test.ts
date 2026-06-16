import { describe, expect, test } from 'vitest';
import { parseSkillMd, rankSkillDocs } from './index.js';

const table = parseSkillMd(
  '---\nname: convert-table\ndescription: Struts table to React\ntriggers: [table, grid]\n---\nbody',
);
const form = parseSkillMd(
  '---\nname: convert-form\ndescription: Struts form to React\ntriggers: [form, input]\n---\nbody',
);

describe('rankSkillDocs', () => {
  test('keeps only skills overlapping the work-order terms (by trigger/name/description)', () => {
    const ranked = rankSkillDocs([form, table], ['table', 'pagination']);
    expect(ranked.map((d) => d.name)).toEqual(['convert-table']); // form has no overlap
  });

  test('caps the result at the limit', () => {
    const ranked = rankSkillDocs([form, table], ['form', 'table'], 1);
    expect(ranked).toHaveLength(1);
  });

  test('returns [] when nothing matches', () => {
    expect(rankSkillDocs([form, table], ['unrelated'])).toEqual([]);
  });
});
