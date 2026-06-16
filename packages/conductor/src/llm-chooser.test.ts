import type { LlmGateway, LlmResponse } from '@loom/agents';
import type { ChooserContext } from '@loom/surveyor';
import { describe, expect, test } from 'vitest';
import { buildChoosePrompt, llmChooser, parseChoice } from './llm-chooser.js';

/** A gateway whose one completion returns a scripted reply. */
function gatewayReturning(content: string | null): LlmGateway {
  return {
    complete: async (): Promise<LlmResponse> => ({
      content,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: 'stop',
    }),
  };
}

const ctx: ChooserContext = {
  url: 'http://app/',
  dom: { tag: 'body', attrs: {}, children: [] },
  candidates: [
    { ref: 'c0', label: 'Delete', kind: 'button' },
    { ref: 'c1', label: 'Accounts', kind: 'menuitem' },
  ],
  visitedKeys: new Set(['k0']),
};

describe('parseChoice', () => {
  test('extracts a valid ref, tolerating prose around the JSON', () => {
    expect(parseChoice('{"ref":"c1"}', ['c0', 'c1'])).toBe('c1');
    expect(parseChoice('I think {"ref":"c0"} is best', ['c0', 'c1'])).toBe('c0');
  });
  test('returns null to backtrack, and rejects a hallucinated ref', () => {
    expect(parseChoice('{"ref":null}', ['c0', 'c1'])).toBeNull();
    expect(parseChoice('{"ref":"c9"}', ['c0', 'c1'])).toBeNull(); // not a real candidate
    expect(parseChoice('no json here', ['c0', 'c1'])).toBeNull();
    expect(parseChoice(null, ['c0', 'c1'])).toBeNull();
  });
});

describe('buildChoosePrompt', () => {
  test('lists the candidates and steers away from destructive actions', () => {
    const msgs = buildChoosePrompt(ctx);
    const system = msgs.find((m) => m.role === 'system')!.content as string;
    const user = msgs.find((m) => m.role === 'user')!.content as string;
    expect(system.toLowerCase()).toContain('delete'); // names destructive actions to avoid
    expect(user).toContain('c1: Accounts');
    expect(user).toContain('1 screens'); // visited count surfaced
  });
});

describe('llmChooser', () => {
  test('asks the model and returns its chosen ref', async () => {
    const chooser = llmChooser(gatewayReturning('{"ref":"c1"}'), 'gpt-5.4');
    expect(await chooser(ctx)).toBe('c1');
  });
  test('returns null (backtrack) on an empty candidate list without calling the model', async () => {
    let called = false;
    const gw: LlmGateway = {
      complete: async () => {
        called = true;
        return {
          content: '{"ref":"c0"}',
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'stop',
        };
      },
    };
    expect(await llmChooser(gw, 'gpt-5.4')({ ...ctx, candidates: [] })).toBeNull();
    expect(called).toBe(false);
  });
});
