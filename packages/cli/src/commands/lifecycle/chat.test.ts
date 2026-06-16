import { describe, expect, test } from 'vitest';
import type { ChatMessage, LlmGateway, LlmRequest, LlmResponse } from '@loom/agents';
import { chatTurn } from './chat.js';

function fakeGateway(reply: string, capture?: (r: LlmRequest) => void): LlmGateway {
  return {
    complete(req: LlmRequest): Promise<LlmResponse> {
      capture?.(req);
      return Promise.resolve({
        content: reply,
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      });
    },
  };
}

describe('chatTurn', () => {
  test('appends the user message, calls the model, and appends the assistant reply', async () => {
    let seen: LlmRequest | undefined;
    const r = await chatTurn(
      fakeGateway('hello there', (x) => (seen = x)),
      {
        model: 'm',
        history: [],
        input: 'hi',
      },
    );
    expect(r.reply).toBe('hello there');
    expect(r.history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello there' },
    ]);
    expect(seen?.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  test('carries prior turns forward as context (full running history)', async () => {
    let seen: LlmRequest | undefined;
    const history: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply1' },
    ];
    await chatTurn(
      fakeGateway('reply2', (x) => (seen = x)),
      { model: 'm', history, input: 'second' },
    );
    expect(seen?.messages).toHaveLength(3);
    expect(seen?.messages[2]).toEqual({ role: 'user', content: 'second' });
  });

  test('does not mutate the caller-supplied history array', async () => {
    const history: ChatMessage[] = [];
    await chatTurn(fakeGateway('x'), { model: 'm', history, input: 'hi' });
    expect(history).toEqual([]);
  });
});
