/**
 * Functional / validation parity (evaluator layer 5): the rebuild must reproduce every form field
 * AND its rules — a dropped field, a lost `required`, a narrowed input type, a removed `maxlength`
 * or `pattern`, or a missing `<select>` option is a behavioral regression a pixel/DOM gate can miss.
 * Deterministic + dependency-free; `FormShape` is structurally compatible with the surveyor's
 * `FormSpec`, so the conductor feeds extracted A/B forms straight in.
 */

export type FieldShape = {
  name: string;
  type: string;
  required: boolean;
  maxLength?: number;
  pattern?: string;
  options?: string[];
};

export type FormShape = { fields: FieldShape[] };

export type FunctionalCode =
  | 'missing-form'
  | 'missing-field'
  | 'changed-type'
  | 'lost-required'
  | 'lost-maxlength'
  | 'lost-pattern'
  | 'changed-options';

export type FunctionalFinding = {
  code: FunctionalCode;
  /** Index of the form on the page. */
  form: number;
  /** Field name (`*` for a whole-form finding). */
  field: string;
  detail?: string;
};

function sameSet(a: string[], b: string[] | undefined): boolean {
  if (!b || a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((x) => bs.has(x));
}

/**
 * Compare the legacy forms (A) against the rebuilt forms (B), in order, reporting every functional
 * regression. An empty result means full functional parity.
 */
export function diffForms(legacy: FormShape[], rebuild: FormShape[]): FunctionalFinding[] {
  const out: FunctionalFinding[] = [];
  legacy.forEach((aForm, i) => {
    const bForm = rebuild[i];
    if (!bForm) {
      out.push({ code: 'missing-form', form: i, field: '*' });
      return;
    }
    const byName = new Map(bForm.fields.map((f) => [f.name, f]));
    for (const a of aForm.fields) {
      const b = byName.get(a.name);
      if (!b) {
        out.push({ code: 'missing-field', form: i, field: a.name });
        continue;
      }
      if (a.type !== b.type)
        out.push({ code: 'changed-type', form: i, field: a.name, detail: `${a.type} → ${b.type}` });
      if (a.required && !b.required) out.push({ code: 'lost-required', form: i, field: a.name });
      if (a.maxLength !== undefined && a.maxLength !== b.maxLength)
        out.push({
          code: 'lost-maxlength',
          form: i,
          field: a.name,
          detail: `${a.maxLength} → ${b.maxLength ?? 'none'}`,
        });
      if (a.pattern !== undefined && a.pattern !== b.pattern)
        out.push({ code: 'lost-pattern', form: i, field: a.name });
      if (a.options && !sameSet(a.options, b.options))
        out.push({ code: 'changed-options', form: i, field: a.name });
    }
  });
  return out;
}

/** True when the rebuild reproduces every field and rule of the legacy forms. */
export function formsMatch(legacy: FormShape[], rebuild: FormShape[]): boolean {
  return diffForms(legacy, rebuild).length === 0;
}
