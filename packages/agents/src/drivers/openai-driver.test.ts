import { MockLlmServer } from '@loom/test-kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { OpenAiDriver } from './openai-driver.js';

let server: MockLlmServer;
let baseUrl: string;
beforeEach(async () => {
  server = new MockLlmServer();
  ({ baseUrl } = await server.start());
});
afterEach(async () => {
  await server.stop();
});

function driver(): OpenAiDriver {
  return new OpenAiDriver({ baseUrl, apiKey: 'test-key' });
}

describe('OpenAiDriver', () => {
  test('completes a text response with mapped usage', async () => {
    server.enqueueText('the answer');
    const res = await driver().complete({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'question' }],
    });
    expect(res.content).toBe('the answer');
    expect(res.toolCalls).toEqual([]);
    expect(res.finishReason).toBe('stop');
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    expect(res.usage.outputTokens).toBeGreaterThan(0);
  });

  test('sends both Authorization Bearer and api-key headers (OpenAI + Azure compat)', async () => {
    server.enqueueText('ok');
    await driver().complete({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    const headers = server.requests[0]?.headers ?? {};
    expect(headers['authorization']).toBe('Bearer test-key');
    expect(headers['api-key']).toBe('test-key');
  });

  test('maps tool schemas to the wire format and parses tool calls back', async () => {
    server.enqueueToolCall('lookup', { id: 42 });
    const res = await driver().complete({
      model: 'm',
      messages: [{ role: 'user', content: 'find it' }],
      tools: [
        {
          name: 'lookup',
          description: 'Look something up',
          parameters: { type: 'object', properties: { id: { type: 'number' } } },
        },
      ],
    });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]?.name).toBe('lookup');
    expect(JSON.parse(res.toolCalls[0]?.arguments ?? '{}')).toEqual({ id: 42 });

    const sentTools = server.requests[0]?.body.tools as {
      type: string;
      function: { name: string };
    }[];
    expect(sentTools[0]?.type).toBe('function');
    expect(sentTools[0]?.function.name).toBe('lookup');
  });

  test('round-trips assistant tool calls and tool results in the message history', async () => {
    server.enqueueText('done');
    await driver().complete({
      model: 'm',
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call_1', name: 'lookup', arguments: '{"id":1}' }],
        },
        { role: 'tool', toolCallId: 'call_1', content: 'result-payload' },
      ],
    });
    const sent = server.requests[0]?.body.messages as Record<string, unknown>[];
    expect(sent[1]?.tool_calls).toBeDefined();
    expect(sent[2]?.role).toBe('tool');
    expect(sent[2]?.tool_call_id).toBe('call_1');
  });

  test('maps maxTokens to max_completion_tokens', async () => {
    server.enqueueText('ok');
    await driver().complete({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 1234,
    });
    expect(server.requests[0]?.body.max_completion_tokens).toBe(1234);
  });

  test('throws a useful error carrying status and server message', async () => {
    server.enqueueError(429, 'rate limited, slow down');
    await expect(
      driver().complete({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/429.*rate limited/s);
  });
});
