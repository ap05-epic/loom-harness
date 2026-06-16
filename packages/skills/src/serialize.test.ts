import { describe, expect, test } from 'vitest';
import { parseSkillMd, serializeSkillMd } from './index.js';

describe('serializeSkillMd', () => {
  test('round-trips with parseSkillMd', () => {
    const doc = { name: 'convert-x', description: 'does x', triggers: ['a', 'b'], body: 'Step 1.' };
    expect(parseSkillMd(serializeSkillMd(doc))).toEqual(doc);
  });

  test('omits the triggers key when there are none', () => {
    const md = serializeSkillMd({ name: 'x', description: 'y', triggers: [], body: 'body' });
    expect(md).not.toContain('triggers');
    expect(parseSkillMd(md).triggers).toEqual([]);
  });
});
