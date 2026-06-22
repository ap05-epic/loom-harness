import type { DomSnapshot } from '@loom/browser';

/** Computed-style values not worth showing (browser defaults / no-ops) — keeps the dump focused. */
const NOISE = new Set(['', 'normal', 'auto', 'none', '0px', 'rgba(0, 0, 0, 0)']);

/**
 * Serialize a captured legacy DOM (with computed styles) into compact annotated HTML — the exact
 * rendered target the model must reproduce: every tag, its text, and the computed styles the checker
 * will compare. This is the single most precise input we can hand the builder (better than a
 * screenshot, because it's the literal values the checker measures). Capped so a large page can't
 * blow the work order.
 */
export function serializeRendered(dom: DomSnapshot, opts: { maxChars?: number } = {}): string {
  const max = opts.maxChars ?? 14000;
  const lines: string[] = [];
  let length = 0;
  const visit = (n: DomSnapshot, depth: number): void => {
    if (length > max) return;
    const indent = '  '.repeat(Math.min(depth, 12));
    const attrs = Object.entries(n.attrs)
      .map(([k, v]) => ` ${k}="${v}"`)
      .join('');
    const styles = n.styles
      ? Object.entries(n.styles)
          .filter(([, v]) => !NOISE.has(v))
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ')
      : '';
    const styleAnno = styles ? `  {${styles}}` : '';
    const text = n.text ? ` "${n.text}"` : '';
    const line = `${indent}<${n.tag}${attrs}>${text}${styleAnno}`;
    lines.push(line);
    length += line.length + 1;
    for (const c of n.children) visit(c, depth + 1);
  };
  visit(dom, 0);
  let s = lines.join('\n');
  if (s.length > max) s = `${s.slice(0, max)}\n… (truncated — match what's shown)`;
  return s;
}
