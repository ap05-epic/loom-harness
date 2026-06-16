import { describe, expect, test } from 'vitest';
import { parseSkillMd } from './index.js';

describe('parseSkillMd', () => {
  test('parses frontmatter (name, description, triggers) and the body', () => {
    const doc = parseSkillMd(
      [
        '---',
        'name: convert-iterate-table',
        'description: Convert a Struts logic:iterate table to a React table',
        'triggers: [table, logic:iterate, grid]',
        '---',
        '',
        'Map each <logic:iterate> row to a <tr>.',
      ].join('\n'),
    );
    expect(doc.name).toBe('convert-iterate-table');
    expect(doc.description).toBe('Convert a Struts logic:iterate table to a React table');
    expect(doc.triggers).toEqual(['table', 'logic:iterate', 'grid']);
    expect(doc.body.trim()).toBe('Map each <logic:iterate> row to a <tr>.');
  });

  test('triggers default to [] when absent', () => {
    const doc = parseSkillMd('---\nname: x\ndescription: y\n---\nbody');
    expect(doc.triggers).toEqual([]);
  });

  test('throws when the YAML frontmatter is missing', () => {
    expect(() => parseSkillMd('just a body, no frontmatter')).toThrow(/frontmatter/i);
  });

  test('throws when name or description is missing', () => {
    expect(() => parseSkillMd('---\nname: x\n---\nbody')).toThrow(/description/i);
  });
});
