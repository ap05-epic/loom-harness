import type { DomSnapshot } from '@loom/browser';

/**
 * A recovered form field and its validation constraints — the input to the evaluator's functional
 * layer (required / maxlength / pattern / options must survive the rebuild) and to the work order
 * (the Builder must reproduce every field). Derived purely from a captured DOM, browser-free.
 */
export type FieldSpec = {
  name: string;
  /** input type, or `select` / `textarea`. */
  type: string;
  required: boolean;
  maxLength?: number;
  pattern?: string;
  /** `<select>` option values. */
  options?: string[];
  label?: string;
  placeholder?: string;
};

export type FormSpec = {
  action?: string;
  method?: string;
  fields: FieldSpec[];
};

const FIELD_TAGS = new Set(['input', 'select', 'textarea']);
const SKIP_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image']);

const textOf = (node: DomSnapshot): string => (node.text ?? '').trim();

function fieldType(node: DomSnapshot): string {
  if (node.tag === 'select') return 'select';
  if (node.tag === 'textarea') return 'textarea';
  return (node.attrs.type ?? 'text').toLowerCase();
}

/** `<label for="x">` → its text, over a form subtree. */
function collectLabelFor(node: DomSnapshot, map: Record<string, string>): void {
  if (node.tag === 'label' && node.attrs.for) map[node.attrs.for] = textOf(node);
  for (const child of node.children) collectLabelFor(child, map);
}

function toField(
  node: DomSnapshot,
  labelFor: Record<string, string>,
  wrapLabel: string | undefined,
): FieldSpec | null {
  const type = fieldType(node);
  if (node.tag === 'input' && SKIP_INPUT_TYPES.has(type)) return null; // actions, not data
  const name = node.attrs.name ?? node.attrs.id;
  if (!name) return null;

  const field: FieldSpec = { name, type, required: node.attrs.required !== undefined };
  if (node.attrs.maxlength !== undefined) {
    const n = Number(node.attrs.maxlength);
    if (!Number.isNaN(n)) field.maxLength = n;
  }
  if (node.attrs.pattern !== undefined) field.pattern = node.attrs.pattern;
  if (node.options) field.options = node.options;
  if (node.attrs.placeholder !== undefined) field.placeholder = node.attrs.placeholder;
  const lbl = (node.attrs.id ? labelFor[node.attrs.id] : undefined) ?? wrapLabel;
  if (lbl) field.label = lbl;
  return field;
}

function collectFields(
  node: DomSnapshot,
  labelFor: Record<string, string>,
  wrapLabel: string | undefined,
  out: FieldSpec[],
): void {
  if (FIELD_TAGS.has(node.tag)) {
    const field = toField(node, labelFor, wrapLabel);
    if (field) out.push(field);
  }
  // A `<label>` wrapping its control labels every field inside it.
  const nextWrap = node.tag === 'label' ? textOf(node) || wrapLabel : wrapLabel;
  for (const child of node.children) collectFields(child, labelFor, nextWrap, out);
}

/**
 * Recover every `<form>` on a page as fields + their validation constraints. Submit/button inputs
 * are dropped (they're actions, not data); labels are resolved by `for=` and by wrapping.
 */
export function extractForms(dom: DomSnapshot): FormSpec[] {
  const forms: FormSpec[] = [];
  const walk = (node: DomSnapshot): void => {
    if (node.tag === 'form') {
      const labelFor: Record<string, string> = {};
      collectLabelFor(node, labelFor);
      const fields: FieldSpec[] = [];
      for (const child of node.children) collectFields(child, labelFor, undefined, fields);
      const form: FormSpec = { fields };
      if (node.attrs.action) form.action = node.attrs.action;
      if (node.attrs.method) form.method = node.attrs.method;
      forms.push(form);
      return; // nested forms are invalid HTML; don't descend
    }
    for (const child of node.children) walk(child);
  };
  walk(dom);
  return forms;
}
