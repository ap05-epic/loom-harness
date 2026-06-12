import { describe, expect, test } from 'vitest';
import { resolveModelProfile } from './model-profile.js';

describe('resolveModelProfile', () => {
  test('resolves GPT-5.4 family defaults (272K standard window, 128K out, vision)', () => {
    const p = resolveModelProfile('gpt-5.4');
    expect(p.contextWindow).toBe(272_000);
    expect(p.maxOutput).toBe(128_000);
    expect(p.vision).toBe(true);
    expect(p.tokenizer).toBe('o200k');
  });

  test('matches model ids with provider prefixes and suffixes', () => {
    expect(resolveModelProfile('azure/gpt-5.4-2026-01').contextWindow).toBe(272_000);
    expect(resolveModelProfile('5.4').contextWindow).toBe(272_000);
  });

  test('resolves Claude family defaults (200K window, vision)', () => {
    const p = resolveModelProfile('claude-sonnet-4-6');
    expect(p.contextWindow).toBe(200_000);
    expect(p.vision).toBe(true);
    expect(p.tokenizer).toBe('anthropic');
  });

  test('unknown models get a conservative fallback profile', () => {
    const p = resolveModelProfile('totally-unknown-model');
    expect(p.contextWindow).toBe(128_000);
    expect(p.maxOutput).toBe(16_000);
    expect(p.vision).toBe(false);
    expect(p.tokenizer).toBe('unknown');
  });

  test('explicit overrides always win', () => {
    const p = resolveModelProfile('gpt-5.4', { contextWindow: 1_050_000, vision: false });
    expect(p.contextWindow).toBe(1_050_000);
    expect(p.maxOutput).toBe(128_000);
    expect(p.vision).toBe(false);
  });
});
