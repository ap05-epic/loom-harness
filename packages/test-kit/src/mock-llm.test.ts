import { afterEach, describe, expect, test } from 'vitest';
import { MockLlmServer } from './mock-llm.js';

let server: MockLlmServer;
afterEach(async () => {
  await server?.stop();
});

async function callCompletions(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify(body),
  });
}

describe('MockLlmServer', () => {
  test('serves a scripted text completion in OpenAI shape', async () => {
    server = new MockLlmServer();
    const { baseUrl } = await server.start();
    server.enqueueText('hello from mock');

    const res = await callCompletions(baseUrl, {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      choices: { message: { role: string; content: string }; finish_reason: string }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    expect(json.choices[0]?.message.content).toBe('hello from mock');
    expect(json.choices[0]?.finish_reason).toBe('stop');
    expect(json.usage.prompt_tokens).toBeGreaterThan(0);
  });

  test('serves a scripted tool call', async () => {
    server = new MockLlmServer();
    const { baseUrl } = await server.start();
    server.enqueueToolCall('get_weather', { city: 'Zurich' });

    const res = await callCompletions(baseUrl, {
      model: 'test-model',
      messages: [{ role: 'user', content: 'weather?' }],
    });
    const json = (await res.json()) as {
      choices: {
        message: { tool_calls: { id: string; function: { name: string; arguments: string } }[] };
        finish_reason: string;
      }[];
    };
    const toolCall = json.choices[0]?.message.tool_calls[0];
    expect(toolCall?.function.name).toBe('get_weather');
    expect(JSON.parse(toolCall?.function.arguments ?? '{}')).toEqual({ city: 'Zurich' });
    expect(json.choices[0]?.finish_reason).toBe('tool_calls');
  });

  test('records received requests for assertions', async () => {
    server = new MockLlmServer();
    const { baseUrl } = await server.start();
    server.enqueueText('ok');

    await callCompletions(baseUrl, {
      model: 'm1',
      messages: [{ role: 'system', content: 'sys' }],
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.body.model).toBe('m1');
    expect(server.requests[0]?.headers['authorization']).toBe('Bearer test');
  });

  test('repeats the last response when the queue is exhausted (loop scripting)', async () => {
    server = new MockLlmServer();
    const { baseUrl } = await server.start();
    server.enqueueToolCall('step', {}, { repeat: true });

    for (let i = 0; i < 3; i++) {
      const res = await callCompletions(baseUrl, { model: 'm', messages: [] });
      const json = (await res.json()) as {
        choices: { message: { tool_calls: { function: { name: string } }[] } }[];
      };
      expect(json.choices[0]?.message.tool_calls[0]?.function.name).toBe('step');
    }
  });

  test('returns a scripted error status when enqueued', async () => {
    server = new MockLlmServer();
    const { baseUrl } = await server.start();
    server.enqueueError(429, 'rate limited');

    const res = await callCompletions(baseUrl, { model: 'm', messages: [] });
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('rate limited');
  });

  test('responds 500 with a clear message when nothing is scripted', async () => {
    server = new MockLlmServer();
    const { baseUrl } = await server.start();
    const res = await callCompletions(baseUrl, { model: 'm', messages: [] });
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/no scripted response/i);
  });
});
