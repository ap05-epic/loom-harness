import { computeBudgets, type Budgets } from './budgets.js';
import { packWorkOrder, type PackResult, type Slot } from './packer.js';
import { counterFor, type TokenCounter } from './tokens.js';
import type { ModelProfile } from '../model-profile.js';

/**
 * Model-adaptive context packer: binds a ModelProfile to its derived budgets,
 * the right token counter, and vision capability, then packs work-order slots
 * accordingly. The same code serves 128K through 1M+ windows.
 */
export class ContextPacker {
  readonly budgets: Budgets;
  private readonly count: TokenCounter;
  private readonly vision: boolean;

  constructor(profile: ModelProfile) {
    this.budgets = computeBudgets(profile);
    this.count = counterFor(profile.tokenizer);
    this.vision = profile.vision;
  }

  /** Assemble slots into a work order within the model's work-order budget. */
  pack(slots: Slot[]): PackResult {
    return packWorkOrder(slots, {
      budget: this.budgets.workOrder,
      count: this.count,
      vision: this.vision,
    });
  }

  countTokens(text: string): number {
    return this.count(text);
  }

  /** True once in-session usage reaches the compaction trigger (condenser time). */
  shouldCompact(usedTokens: number): boolean {
    return usedTokens >= this.budgets.compactionTrigger;
  }
}
