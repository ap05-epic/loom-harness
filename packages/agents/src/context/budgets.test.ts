import { describe, expect, test } from 'vitest';
import { computeBudgets } from './budgets.js';
import { resolveModelProfile } from '../model-profile.js';

describe('computeBudgets', () => {
  test('GPT-5.4 (272K/128K) matches the plan defaults', () => {
    const b = computeBudgets(resolveModelProfile('gpt-5.4'));
    expect(b.window).toBe(272_000);
    expect(b.workOrder).toBe(68_000); // 25% of 272K, within [24K,120K]
    expect(b.compactionTrigger).toBe(239_360); // 88%
    expect(b.perTurnOutput).toBe(16_000); // min(16K, 128K/4)
  });

  test('1M window caps the work order at 120K (no codebase dumps)', () => {
    const b = computeBudgets({
      contextWindow: 1_050_000,
      maxOutput: 128_000,
      vision: true,
      tokenizer: 'o200k',
    });
    expect(b.workOrder).toBe(120_000);
    expect(b.compactionTrigger).toBe(924_000);
    expect(b.perTurnOutput).toBe(16_000);
  });

  test('128K window: 25% work order, output capped by maxOutput/4', () => {
    const b = computeBudgets({
      contextWindow: 128_000,
      maxOutput: 16_000,
      vision: true,
      tokenizer: 'o200k',
    });
    expect(b.workOrder).toBe(32_000);
    expect(b.perTurnOutput).toBe(4_000);
  });

  test('small 64K window: work order respects the 24K floor', () => {
    const b = computeBudgets({
      contextWindow: 64_000,
      maxOutput: 8_000,
      vision: false,
      tokenizer: 'unknown',
    });
    expect(b.workOrder).toBe(24_000);
    expect(b.perTurnOutput).toBe(2_000);
  });

  test('200K Claude-class window', () => {
    const b = computeBudgets(resolveModelProfile('claude-sonnet-4-6'));
    expect(b.window).toBe(200_000);
    expect(b.workOrder).toBe(50_000);
    expect(b.compactionTrigger).toBe(176_000);
  });
});
