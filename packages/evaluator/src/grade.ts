/**
 * The unified screen scorecard: collapse every deterministic layer's result into one pass/fail
 * verdict + human-readable reasons. A screen passes only when ALL layers clear — visual, structural
 * DOM, computed-style, functional/validation, accessibility, and anti-cheat. The single place that
 * answers "did this rebuild pass parity?", so the report, the gate, and the Fixer agree.
 */

export type ScreenLayers = {
  visual: { passed: boolean; diffPercent: number };
  /** Counts of each layer's findings (0 / omitted = that layer clean or not run). */
  structuralFindings?: number;
  styleFindings?: number;
  functionalFindings?: number;
  a11yFindings?: number;
  copiedAssets?: number;
};

export type Scorecard = {
  passed: boolean;
  /** One line per failing layer (empty when the screen passes). */
  reasons: string[];
};

/** Grade a screen across all layers into one verdict. */
export function gradeScreen(layers: ScreenLayers): Scorecard {
  const reasons: string[] = [];
  if (!layers.visual.passed) reasons.push(`visual diff ${layers.visual.diffPercent.toFixed(2)}%`);
  if (layers.structuralFindings) reasons.push(`structural: ${layers.structuralFindings}`);
  if (layers.styleFindings) reasons.push(`computed-style: ${layers.styleFindings}`);
  if (layers.functionalFindings) reasons.push(`functional: ${layers.functionalFindings}`);
  if (layers.a11yFindings) reasons.push(`a11y regressions: ${layers.a11yFindings}`);
  if (layers.copiedAssets) reasons.push(`copied assets: ${layers.copiedAssets}`);
  return { passed: reasons.length === 0, reasons };
}
