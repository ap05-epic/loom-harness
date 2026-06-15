import { describe, expect, test } from 'vitest';
import { ContextPacker } from './context-packer.js';
import { resolveModelProfile } from '../model-profile.js';
import type { ModelProfile } from '../model-profile.js';
import type { Slot } from './packer.js';

// Heuristic tokenizer keeps the big-string cases fast + deterministic (no
// gpt-tokenizer on hundreds of KB), while still exercising the 272K budget math.
const bigProfile: ModelProfile = {
  contextWindow: 272_000,
  maxOutput: 128_000,
  vision: true,
  tokenizer: 'unknown',
};

const slots: Slot[] = [
  { name: 'task', content: 'do the thing', priority: 0, shrink: 'keep' },
  {
    name: 'source',
    content: 'x'.repeat(500_000),
    priority: 1,
    shrink: 'truncate',
    maxTokens: 60_000,
  },
  {
    name: 'screenshot',
    content: '<img>',
    priority: 9,
    shrink: 'drop',
    requiresVision: true,
    tokenEstimate: 1000,
  },
];

describe('ContextPacker', () => {
  test('exposes budgets derived from the model profile', () => {
    const packer = new ContextPacker(resolveModelProfile('gpt-5.4'));
    expect(packer.budgets.workOrder).toBe(68_000);
    expect(packer.budgets.compactionTrigger).toBe(239_360);
  });

  test('packs within budget, keeps the task spec, truncates source, leaves room for screenshots', () => {
    const packer = new ContextPacker(bigProfile);
    const result = packer.pack(slots);
    expect(result.usedTokens).toBeLessThanOrEqual(packer.budgets.workOrder + 50);
    expect(result.slots.find((s) => s.name === 'task')!.status).toBe('full');
    expect(result.slots.find((s) => s.name === 'source')!.status).toBe('truncated');
    // the per-slot cap on source leaves budget for the (vision-capable) screenshot
    expect(result.slots.find((s) => s.name === 'screenshot')!.status).toBe('full');
  });

  test('drops screenshots for a no-vision model and counts tokens for its tokenizer', () => {
    const packer = new ContextPacker({
      contextWindow: 128_000,
      maxOutput: 16_000,
      vision: false,
      tokenizer: 'unknown',
    });
    const result = packer.pack(slots);
    expect(result.slots.find((s) => s.name === 'screenshot')!.status).toBe('dropped');
    expect(packer.countTokens('hello')).toBeGreaterThan(0);
  });

  test('shouldCompact reflects the compaction trigger', () => {
    const packer = new ContextPacker(resolveModelProfile('gpt-5.4'));
    expect(packer.shouldCompact(100_000)).toBe(false);
    expect(packer.shouldCompact(240_000)).toBe(true);
  });
});
