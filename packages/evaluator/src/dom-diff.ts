/** A normalized DOM node — the structural model the evaluator compares (browser-extracted). */
export type DomNode = {
  /** Lowercased tag name. */
  tag: string;
  /** ARIA role, if meaningful. */
  role?: string;
  /** Normalized visible text (leaf/label elements). */
  text?: string;
  /** Significant attributes only (name, type, href, …) — presentation attrs excluded upstream. */
  attrs: Record<string, string>;
  /** Option values for a <select>. */
  options?: string[];
  /** Computed-style digest (significant properties only), if captured. */
  styles?: Record<string, string>;
  children: DomNode[];
};

export type DomFindingCode =
  | 'missing-element'
  | 'extra-element'
  | 'changed-tag'
  | 'changed-attr'
  | 'missing-attr'
  | 'extra-attr'
  | 'changed-text'
  | 'changed-role'
  | 'missing-option'
  | 'extra-option';

export type DomFinding = {
  path: string;
  code: DomFindingCode;
  detail: string;
};

export type DomDiffResult = {
  matched: boolean;
  findings: DomFinding[];
};

/** Attributes that carry semantics (not presentation) — the default comparison set. */
export const DEFAULT_SIGNIFICANT_ATTRS = [
  'name',
  'type',
  'href',
  'src',
  'alt',
  'value',
  'for',
  'placeholder',
  'title',
  'aria-label',
  'aria-labelledby',
  'checked',
  'selected',
  'disabled',
  'required',
  'readonly',
  'maxlength',
  'min',
  'max',
  'step',
  'pattern',
  'colspan',
  'rowspan',
];

export type DomDiffOptions = {
  /** Attribute names to compare (default: DEFAULT_SIGNIFICANT_ATTRS). */
  significantAttrs?: string[];
};

const normText = (t: string | undefined): string => (t ?? '').replace(/\s+/g, ' ').trim();

function describe(node: DomNode): string {
  const name = node.attrs.name ? `[name=${node.attrs.name}]` : '';
  return `<${node.tag}${name}>`;
}

function childPath(path: string, node: DomNode, index: number): string {
  const key = node.attrs.name ? `[name=${node.attrs.name}]` : `:nth(${index})`;
  return `${path} > ${node.tag}${key}`;
}

function walk(
  a: DomNode,
  b: DomNode,
  path: string,
  findings: DomFinding[],
  significant: string[],
): void {
  if (a.tag !== b.tag) {
    findings.push({ path, code: 'changed-tag', detail: `${a.tag} → ${b.tag}` });
    return; // different element — deeper comparison is meaningless
  }

  if ((a.role ?? '') !== (b.role ?? '')) {
    findings.push({
      path,
      code: 'changed-role',
      detail: `${a.role ?? '(none)'} → ${b.role ?? '(none)'}`,
    });
  }

  for (const key of significant) {
    const av = a.attrs[key];
    const bv = b.attrs[key];
    if (av !== undefined && bv === undefined) {
      findings.push({ path, code: 'missing-attr', detail: `${key}="${av}"` });
    } else if (av === undefined && bv !== undefined) {
      findings.push({ path, code: 'extra-attr', detail: `${key}="${bv}"` });
    } else if (av !== undefined && bv !== undefined && av !== bv) {
      findings.push({ path, code: 'changed-attr', detail: `${key}: "${av}" → "${bv}"` });
    }
  }

  if (normText(a.text) !== normText(b.text)) {
    findings.push({
      path,
      code: 'changed-text',
      detail: `"${normText(a.text)}" → "${normText(b.text)}"`,
    });
  }

  if (a.options || b.options) {
    const ao = a.options ?? [];
    const bo = b.options ?? [];
    for (const o of ao)
      if (!bo.includes(o)) findings.push({ path, code: 'missing-option', detail: `option "${o}"` });
    for (const o of bo)
      if (!ao.includes(o)) findings.push({ path, code: 'extra-option', detail: `option "${o}"` });
  }

  const an = a.children;
  const bn = b.children;
  const max = Math.max(an.length, bn.length);
  for (let i = 0; i < max; i++) {
    const ac = an[i];
    const bc = bn[i];
    if (ac && !bc) {
      findings.push({
        path: childPath(path, ac, i),
        code: 'missing-element',
        detail: describe(ac),
      });
    } else if (!ac && bc) {
      findings.push({ path: childPath(path, bc, i), code: 'extra-element', detail: describe(bc) });
    } else if (ac && bc) {
      walk(ac, bc, childPath(path, ac, i), findings, significant);
    }
  }
}

/**
 * Structural/semantic DOM comparison — the layer that catches what a pixel gate
 * can't: a missing dropdown option, a text→password input swap, a relabelled
 * control, a dropped form field, a changed link target. Pure and deterministic;
 * compares two normalized trees by position (faithful rebuilds preserve order).
 */
export function diffDom(a: DomNode, b: DomNode, options: DomDiffOptions = {}): DomDiffResult {
  const findings: DomFinding[] = [];
  walk(a, b, a.tag, findings, options.significantAttrs ?? DEFAULT_SIGNIFICANT_ATTRS);
  return { matched: findings.length === 0, findings };
}
