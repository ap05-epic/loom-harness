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
  /** Build/compile errors — the replica didn't build, so there's nothing to compare yet. */
  build?: string[];
};

/** The combined verdict: 1:1 only when every gate is clean and visual is within threshold. */
export type ParityReport = ParityInput & { matched: boolean };

/**
 * Which gates must be clean for a 1:1 verdict.
 * - `strict` (default): every gate — visual + DOM structure + computed style + forms + routes.
 * - `visual`: the **visible + behavioural** bar — visual pixels + forms + routes (+ no build error).
 *   DOM‑tag / per‑node computed‑style nuances stay advisory (still reported + fed to the model), so a
 *   screen that looks and works identically counts as matched even if an invisible `<span>` style
 *   differs. The visual pixel diff is the backstop for anything that actually looks different.
 */
export type ParityGate = 'strict' | 'visual';

/** Combine the gate results into the verdict. The machine decides `matched` — no LLM. */
export function buildReport(input: ParityInput, gate: ParityGate = 'strict'): ParityReport {
  const noBuildError = (input.build ?? []).length === 0;
  const visualOk = input.visualPct <= input.threshold;
  const functionalOk = input.forms.length === 0 && input.paths.length === 0;
  const structuralOk = input.dom.length === 0 && input.style.length === 0;
  const matched = noBuildError && visualOk && functionalOk && (gate === 'visual' || structuralOk);
  return { ...input, matched };
}

/**
 * The concrete differences for the model to fix — ONLY the gaps, grouped by gate. Empty when 1:1.
 * This is the entire instruction the fix loop hands the LLM: it never judges parity, it only closes
 * the gaps the machine found.
 */
export function diffsForLlm(r: ParityReport): string {
  if (r.matched) return '';
  // A build error short-circuits everything: nothing rendered, so the other gates are meaningless.
  const buildErrors = r.build ?? [];
  if (buildErrors.length > 0) {
    return (
      buildErrors.map((b) => `BUILD ERROR: ${b}`).join('\n\n') +
      '\n\nFix the code so it builds; then we re-check.'
    );
  }
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
    const notes = r.dom.length + r.style.length;
    if (notes > 0) {
      return `✓ visible match — visual ${r.visualPct.toFixed(1)}%, forms/routes clean; ${notes} cosmetic style/structure note(s) remain (not blocking under the visible gate).`;
    }
    return `✓ 1:1 match — visual ${r.visualPct.toFixed(1)}%, structure/style/forms/routes all clean.`;
  }
  const buildErrors = r.build ?? [];
  if (buildErrors.length > 0) {
    return `✗ build failed — ${buildErrors.length} error(s); the replica didn't compile.`;
  }
  return (
    `✗ not yet 1:1 — visual ${r.visualPct.toFixed(1)}% (target ≤ ${r.threshold}%) · ` +
    `structure ${r.dom.length} · style ${r.style.length} · forms ${r.forms.length} · routes ${r.paths.length}`
  );
}
