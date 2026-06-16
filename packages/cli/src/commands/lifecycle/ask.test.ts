import { describe, expect, test } from 'vitest';
import type { LlmGateway, LlmRequest, LlmResponse } from '@loom/agents';
import { askOnce } from './ask.js';

/** A gateway that records the request and returns a fixed reply — no network. */
function fakeGateway(reply: string | null, capture?: (r: LlmRequest) => void): LlmGateway {
  return {
    complete(req: LlmRequest): Promise<LlmResponse> {
      capture?.(req);
      return Promise.resolve({
        content: reply,
        toolCalls: [],
        usage: { inputTokens: 3, outputTokens: 2 },
        finishReason: 'stop',
      });
    },
  };
}

describe('askOnce', () => {
  test('sends the prompt as a user message and returns the trimmed answer + usage', async () => {
    let seen: LlmRequest | undefined;
    const res = await askOnce(
      fakeGateway('  pong  ', (r) => (seen = r)),
      {
        model: 'gpt-5.4',
        prompt: 'say pong',
      },
    );
    expect(res.answer).toBe('pong');
    expect(res.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(seen?.model).toBe('gpt-5.4');
    expect(seen?.messages).toEqual([{ role: 'user', content: 'say pong' }]);
  });

  test('prepends a system instruction when given', async () => {
    let seen: LlmRequest | undefined;
    await askOnce(
      fakeGateway('ok', (r) => (seen = r)),
      {
        model: 'm',
        prompt: 'hi',
        system: 'Be terse.',
      },
    );
    expect(seen?.messages[0]).toEqual({ role: 'system', content: 'Be terse.' });
    expect(seen?.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  test('passes maxTokens through', async () => {
    let seen: LlmRequest | undefined;
    await askOnce(
      fakeGateway('ok', (r) => (seen = r)),
      { model: 'm', prompt: 'hi', maxTokens: 256 },
    );
    expect(seen?.maxTokens).toBe(256);
  });

  test('a null completion becomes an empty answer (no crash)', async () => {
    const res = await askOnce(fakeGateway(null), { model: 'm', prompt: 'x' });
    expect(res.answer).toBe('');
  });
});
