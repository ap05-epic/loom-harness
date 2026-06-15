import type { TokenCounter } from './tokens.js';

export type SlotShrink = 'keep' | 'truncate' | 'drop';

export type Slot = {
  name: string;
  content: string;
  /** Lower = more important; packed first. Slot priority 0 is the task spec. */
  priority: number;
  /** keep = never shrink (task spec); truncate = cut the tail to fit; drop = omit whole. */
  shrink: SlotShrink;
  /** Image/screenshot slots are dropped when the model lacks vision. */
  requiresVision?: boolean;
  /** Fixed token estimate (e.g. images) used instead of counting content. */
  tokenEstimate?: number;
  /** Per-slot target budget; the slot never takes more than this (leaves room for later slots). */
  maxTokens?: number;
};

export type PackedSlot = {
  name: string;
  tokens: number;
  status: 'full' | 'truncated' | 'dropped';
};

export type PackResult = {
  text: string;
  usedTokens: number;
  budget: number;
  slots: PackedSlot[];
};

export type PackOptions = {
  budget: number;
  count: TokenCounter;
  vision?: boolean;
};

const TRUNCATION_MARKER = '\n…[truncated]';
const MIN_TRUNCATED_TOKENS = 4;

/**
 * Cut text down so it counts at or under maxTokens, appending a marker.
 * Estimates chars-per-token from a head sample so it never counts the full
 * (possibly huge) string — only bounded slices, a few times at most.
 */
function truncateToTokens(text: string, maxTokens: number, count: TokenCounter): string {
  const markerTokens = count(TRUNCATION_MARKER);
  const target = Math.max(0, maxTokens - markerTokens);
  if (target <= 0) return TRUNCATION_MARKER;

  const sample = text.slice(0, 8000);
  const sampleTokens = count(sample) || 1;
  const charsPerToken = Math.max(1, sample.length / sampleTokens);

  let chars = Math.min(text.length, Math.floor(target * charsPerToken));
  let slice = text.slice(0, chars);
  let guard = 0;
  while (chars > 0 && count(slice) > target && guard++ < 8) {
    chars = Math.floor(chars * 0.85);
    slice = text.slice(0, chars);
  }
  return slice + TRUNCATION_MARKER;
}

/**
 * Pack named slots into the work-order budget using the shrink ladder: slots are
 * filled most-important-first; the task spec (and any `keep` slot) is never
 * truncated; lower-priority `truncate` slots are cut to whatever budget remains;
 * `drop` slots that don't fit are omitted. Vision slots are dropped when the
 * model has no image input. Returns the assembled text + a per-slot report.
 */
export function packWorkOrder(slots: Slot[], options: PackOptions): PackResult {
  const { budget, count } = options;
  const vision = options.vision ?? false;
  const ordered = [...slots].sort((a, b) => a.priority - b.priority);

  let remaining = budget;
  const report: PackedSlot[] = [];
  const included: Array<{ name: string; content: string }> = [];

  for (const slot of ordered) {
    if (slot.requiresVision && !vision) {
      report.push({ name: slot.name, tokens: 0, status: 'dropped' });
      continue;
    }
    // A keep slot is always included in full (the task spec is never cut),
    // even if it overruns the budget.
    if (slot.shrink === 'keep') {
      const cost = slot.tokenEstimate ?? count(slot.content);
      included.push({ name: slot.name, content: slot.content });
      report.push({ name: slot.name, tokens: cost, status: 'full' });
      remaining -= cost;
      continue;
    }

    // The slot may take at most its own target cap and whatever budget is left,
    // so one big slot can't starve later (e.g. screenshot) slots.
    const allowed = Math.min(slot.maxTokens ?? remaining, remaining);
    const cost = slot.tokenEstimate ?? count(slot.content);

    if (cost <= allowed) {
      included.push({ name: slot.name, content: slot.content });
      report.push({ name: slot.name, tokens: cost, status: 'full' });
      remaining -= cost;
      continue;
    }
    if (
      slot.shrink === 'truncate' &&
      allowed >= MIN_TRUNCATED_TOKENS &&
      slot.tokenEstimate === undefined
    ) {
      const content = truncateToTokens(slot.content, allowed, count);
      const tokens = count(content);
      included.push({ name: slot.name, content });
      report.push({ name: slot.name, tokens, status: 'truncated' });
      remaining -= tokens;
      continue;
    }
    report.push({ name: slot.name, tokens: 0, status: 'dropped' });
  }

  const text = included.map((s) => `## ${s.name}\n${s.content}`).join('\n\n');
  const usedTokens = report.reduce((sum, s) => sum + s.tokens, 0);
  return { text, usedTokens, budget, slots: report };
}
