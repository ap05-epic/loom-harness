import type { ModelProfile } from '../model-profile.js';

export type Budgets = {
  /** Total context window of the active model. */
  window: number;
  /** Hard cap on the packed work order (≤25% of window, floor 24K, ceiling 120K). */
  workOrder: number;
  /** Expected in-session growth headroom (informational). */
  inSessionGrowth: number;
  /** Used-token level at which the session compacts (condenser-style). */
  compactionTrigger: number;
  /** Per-turn completion cap (min 16K, never more than a quarter of max output). */
  perTurnOutput: number;
};

const WORK_ORDER_RATIO = 0.25;
const WORK_ORDER_FLOOR = 24_000;
const WORK_ORDER_CEILING = 120_000;
const GROWTH_RATIO = 0.6;
const COMPACTION_RATIO = 0.88;
const OUTPUT_CAP = 16_000;

/**
 * Derive all packing budgets from a ModelProfile as ratios of its window, with
 * floors/ceilings — the same math instantiates for 128K through 1M+ windows.
 */
export function computeBudgets(profile: ModelProfile): Budgets {
  const window = profile.contextWindow;
  return {
    window,
    workOrder: Math.min(
      Math.max(Math.round(window * WORK_ORDER_RATIO), WORK_ORDER_FLOOR),
      WORK_ORDER_CEILING,
    ),
    inSessionGrowth: Math.round(window * GROWTH_RATIO),
    compactionTrigger: Math.round(window * COMPACTION_RATIO),
    perTurnOutput: Math.min(OUTPUT_CAP, Math.floor(profile.maxOutput / 4)),
  };
}
