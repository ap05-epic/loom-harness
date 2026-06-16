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
