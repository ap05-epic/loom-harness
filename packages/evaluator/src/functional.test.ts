import { describe, expect, test } from 'vitest';
import { diffForms, formsMatch, type FormShape } from './functional.js';

const legacy: FormShape[] = [
  {
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'age', type: 'number', required: false, maxLength: 3 },
      { name: 'country', type: 'select', required: true, options: ['us', 'ca'] },
    ],
  },
];

describe('diffForms', () => {
  test('an exact rebuild reports no functional regressions', () => {
    expect(diffForms(legacy, legacy)).toEqual([]);
    expect(formsMatch(legacy, legacy)).toBe(true);
  });

  test('catches a dropped field, a lost validation rule, and changed options', () => {
    const rebuild: FormShape[] = [
      {
        fields: [
          { name: 'email', type: 'email', required: false }, // lost required
          // age dropped entirely
          { name: 'country', type: 'select', required: true, options: ['us'] }, // option removed
        ],
      },
    ];
    const codes = diffForms(legacy, rebuild).map((f) => `${f.code}:${f.field}`);
    expect(codes).toContain('lost-required:email');
    expect(codes).toContain('missing-field:age');
    expect(codes).toContain('changed-options:country');
    expect(formsMatch(legacy, rebuild)).toBe(false);
  });

  test('catches a changed input type and a lost maxlength', () => {
    const rebuild: FormShape[] = [
      {
        fields: [
          { name: 'email', type: 'text', required: true }, // type narrowed away
          { name: 'age', type: 'number', required: false }, // maxLength dropped
          { name: 'country', type: 'select', required: true, options: ['us', 'ca'] },
        ],
      },
    ];
    const codes = diffForms(legacy, rebuild).map((f) => `${f.code}:${f.field}`);
    expect(codes).toContain('changed-type:email');
    expect(codes).toContain('lost-maxlength:age');
  });

  test('flags a whole form missing from the rebuild', () => {
    expect(diffForms(legacy, []).map((f) => f.code)).toContain('missing-form');
  });
});
