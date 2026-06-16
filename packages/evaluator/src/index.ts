export { diffImages, type DiffOptions, type DiffResult, type Rect } from './diff.js';
export {
  scoreVisual,
  type StateDiff,
  type VisualScoreOptions,
  type VisualVerdict,
} from './scorecard.js';
export {
  evaluateVisual,
  type CapturePair,
  type PairResult,
  type VisualEvalOptions,
  type VisualEvalResult,
} from './evaluate.js';
export {
  diffDom,
  DEFAULT_SIGNIFICANT_ATTRS,
  type DomNode,
  type DomFinding,
  type DomFindingCode,
  type DomDiffResult,
  type DomDiffOptions,
} from './dom-diff.js';
export {
  diffStyles,
  DEFAULT_STYLE_PROPS,
  type StyleFinding,
  type StyleDiffResult,
  type StyleDiffOptions,
} from './style-diff.js';
export { coverageLedger, type CoverageInput, type CoverageReport } from './coverage.js';
export {
  classifyAsset,
  assetDigest,
  findCopiedAssets,
  type AssetKind,
  type AssetDigest,
  type CopiedAsset,
} from './anticheat.js';
export {
  diffForms,
  formsMatch,
  type FieldShape,
  type FormShape,
  type FunctionalCode,
  type FunctionalFinding,
} from './functional.js';
export {
  diffA11y,
  a11yRegressed,
  type A11yImpact,
  type A11yViolation,
  type A11yFinding,
} from './a11y.js';
export { gradeScreen, type ScreenLayers, type Scorecard } from './grade.js';
