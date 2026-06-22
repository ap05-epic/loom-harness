import type { DomFinding, FunctionalFinding, StyleFinding } from '@loom/evaluator';
import type { PathFinding } from './paths.js';

/** The raw deterministic gate results for one screen, before the matched verdict. */
export type ParityInput = {
  /** Worst visual pixel-diff % across viewports. */
  visualPct: number;
  /** Max acceptable visual %. */
  threshold: number;
  dom: DomFinding[];
  style: StyleFinding[];
  forms: FunctionalFinding[];
  paths: PathFinding[];
};

/** The combined verdict: 1:1 only when every gate is clean and visual is within threshold. */
export type ParityReport = ParityInput & { matched: boolean };

/** Combine the gate results into the verdict. The machine decides `matched` — no LLM. */
export function buildReport(input: ParityInput): ParityReport {
  const matched =
    input.visualPct <= input.threshold &&
    input.dom.length === 0 &&
    input.style.length === 0 &&
    input.forms.length === 0 &&
    input.paths.length === 0;
  return { ...input, matched };
}

/**
 * The concrete differences for the model to fix — ONLY the gaps, grouped by gate. Empty when 1:1.
 * This is the entire instruction the fix loop hands the LLM: it never judges parity, it only closes
 * the gaps the machine found.
 */
export function diffsForLlm(r: ParityReport): string {
  if (r.matched) return '';
  const lines: string[] = [];
  if (r.visualPct > r.threshold) {
    lines.push(
      `VISUAL: ${r.visualPct.toFixed(1)}% pixel difference vs the original (target ≤ ${r.threshold}%). ` +
        `Adjust layout, spacing, colors, fonts, and sizes to close it.`,
    );
  }
  for (const f of r.dom) lines.push(`STRUCTURE [${f.code}] at ${f.path}: ${f.detail}`);
  for (const f of r.style) lines.push(`STYLE ${f.path} { ${f.prop} }: ${f.detail}`);
  for (const f of r.forms)
    lines.push(`FORM [${f.code}] field "${f.field}"${f.detail ? `: ${f.detail}` : ''}`);
  for (const f of r.paths) lines.push(`ROUTE missing "${f.target}": ${f.detail}`);
  return lines.join('\n');
}

/** A one-line terminal summary of the parity verdict. */
export function printReport(r: ParityReport): string {
  if (r.matched) {
    return `✓ 1:1 match — visual ${r.visualPct.toFixed(1)}%, structure/style/forms/routes all clean.`;
  }
  return (
    `✗ not yet 1:1 — visual ${r.visualPct.toFixed(1)}% (target ≤ ${r.threshold}%) · ` +
    `structure ${r.dom.length} · style ${r.style.length} · forms ${r.forms.length} · routes ${r.paths.length}`
  );
}
