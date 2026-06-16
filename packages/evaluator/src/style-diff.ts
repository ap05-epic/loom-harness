import type { DomNode } from './dom-diff.js';

export type StyleFinding = {
  path: string;
  prop: string;
  detail: string;
};

export type StyleDiffResult = {
  matched: boolean;
  findings: StyleFinding[];
};

/**
 * The computed-style properties that carry visible meaning — typography, colour,
 * borders, and spacing. Layout dimensions (width/height) are intentionally
 * excluded: they're viewport-dependent and the pixel layer already covers them.
 */
export const DEFAULT_STYLE_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration-line',
  'text-transform',
  'color',
  'background-color',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-right-width',
  'border-right-style',
  'border-right-color',
  'border-bottom-width',
  'border-bottom-style',
  'border-bottom-color',
  'border-left-width',
  'border-left-style',
  'border-left-color',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
];

export type StyleDiffOptions = {
  props?: string[];
};

function childPath(path: string, node: DomNode, index: number): string {
  const key = node.attrs.name ? `[name=${node.attrs.name}]` : `:nth(${index})`;
  return `${path} > ${node.tag}${key}`;
}

function walk(
  a: DomNode,
  b: DomNode,
  path: string,
  findings: StyleFinding[],
  props: string[],
): void {
  // Compare only where both sides carry a digest — skip otherwise (graceful).
  if (a.styles && b.styles) {
    for (const prop of props) {
      const av = a.styles[prop];
      const bv = b.styles[prop];
      if (av !== undefined && bv !== undefined && av !== bv) {
        findings.push({ path, prop, detail: `${prop}: "${av}" → "${bv}"` });
      }
    }
  }

  // Walk by position (faithful rebuilds preserve structure; mismatches are the
  // structural layer's job — here we only compare style where both nodes exist).
  const an = a.children;
  const bn = b.children;
  const count = Math.min(an.length, bn.length);
  for (let i = 0; i < count; i++) {
    walk(an[i]!, bn[i]!, childPath(path, an[i]!, i), findings, props);
  }
}

/**
 * Computed-style comparison — the layer that catches sub-threshold "death by
 * 1px" drift: a 1px border, a slightly-off font weight, a wrong colour that
 * moves too few pixels to trip the visual gate. Pure; compares two normalized
 * trees (with style digests) by position over a curated property set.
 */
export function diffStyles(
  a: DomNode,
  b: DomNode,
  options: StyleDiffOptions = {},
): StyleDiffResult {
  const findings: StyleFinding[] = [];
  walk(a, b, a.tag, findings, options.props ?? DEFAULT_STYLE_PROPS);
  return { matched: findings.length === 0, findings };
}
