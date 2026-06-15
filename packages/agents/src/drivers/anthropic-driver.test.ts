import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { AgentRunner } from '../agent-runner.js';
import type { ToolDef } from '../types.js';
import {
  AnthropicDriver,
  buildAnthropicRequest,
  parseAnthropicResponse,
} from './anthropic-driver.js';

describe('buildAnthropicRequest', () => {
  test('lifts system messages into the system field', () => {
    const body = buildAnthropicRequest({
      model: 'claude',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  test('maps assistant tool calls to tool_use content blocks', () => {
    const body = buildAnthropicRequest({
      model: 'claude',
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call_1', name: 'lookup', arguments: '{"id":1}' }],
        },
      ],
    });
    const assistant = body.messages[1]!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'lookup', input: { id: 1 } },
    ]);
  });

  test('merges consecutive tool results into one user message of tool_result blocks', () => {
    const body = buildAnthropicRequest({
      model: 'claude',
      messages: [
        { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'a', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'c1', content: 'r1' },
        { role: 'tool', toolCallId: 'c2', content: 'r2' },
      ],
    });
    const last = body.messages[body.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toEqual([
      { type: 'tool_result', tool_use_id: 'c1', content: 'r1' },
      { type: 'tool_result', tool_use_id: 'c2', content: 'r2' },
    ]);
  });

  test('maps tools to Anthropic input_schema and always sets max_tokens', () => {
    const body = buildAnthropicRequest({
      model: 'claude',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 't', description: 'd', parameters: { type: 'object', properties: {} } }],
      maxTokens: 1234,
    });
    expect(body.tools).toEqual([
      { name: 't', description: 'd', input_schema: { type: 'object', properties: {} } },
    ]);
    expect(body.max_tokens).toBe(1234);
  });
});

describe('parseAnthropicResponse', () => {
  test('collects text and tool_use blocks and maps usage', () => {
    const res = parseAnthropicResponse({
      content: [
        { type: 'text', text: 'thinking ' },
        { type: 'tool_use', id: 'u1', name: 'lookup', input: { id: 7 } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 12, output_tokens: 5 },
    });
    expect(res.content).toBe('thinking ');
    expect(res.toolCalls).toEqual([{ id: 'u1', name: 'lookup', arguments: '{"id":7}' }]);
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(res.finishReason).toBe('tool_use');
  });

  test('text-only response has empty toolCalls', () => {
    const res = parseAnthropicResponse({
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 1 },
    });
    expect(res.content).toBe('done');
    expect(res.toolCalls).toEqual([]);
  });
});

describe('AnthropicDriver (integration via a stub Messages endpoint)', () => {
  let server: Server;
  afterEach(() => server?.close());

  function stub(json: unknown): Promise<string> {
    return new Promise((resolve) => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          (server as Server & { lastBody?: string }).lastBody = body;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(json));
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as AddressInfo).port;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  }

  test('completes a request and parses the Anthropic response', async () => {
    const baseUrl = await stub({
      content: [{ type: 'text', text: 'pong' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 4, output_tokens: 1 },
    });
    const driver = new AnthropicDriver({ baseUrl, apiKey: 'k' });
    const res = await driver.complete({
      model: 'claude',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(res.content).toBe('pong');
    expect(res.usage.inputTokens).toBe(4);
    const sent = JSON.parse((server as Server & { lastBody?: string }).lastBody ?? '{}');
    expect(sent.max_tokens).toBeGreaterThan(0); // required by the API
  });

  test('drives a full AgentRunner tool loop (driver-agnostic conformance)', async () => {
    const queue = [
      {
        content: [{ type: 'tool_use', id: 'u1', name: 'echo', input: { text: 'hi' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 5, output_tokens: 2 },
      },
      {
        content: [{ type: 'text', text: 'final answer' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 6, output_tokens: 3 },
      },
    ];
    const baseUrl = await new Promise<string>((resolve) => {
      server = createServer((req, res) => {
        req.on('data', () => {});
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(queue.shift() ?? queue[0]));
        });
      });
      server.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
      );
    });

    const echo: ToolDef = {
      name: 'echo',
      description: 'echo',
      parameters: { type: 'object', properties: {} },
      execute: (args) => `echoed:${(args as { text?: string }).text}`,
    };
    const runner = new AgentRunner(new AnthropicDriver({ baseUrl, apiKey: 'k' }));
    const result = await runner.run({
      model: 'claude',
      messages: [{ role: 'user', content: 'use echo then answer' }],
      tools: [echo],
      guards: { maxIterations: 5, maxTokens: 1_000_000, maxWallClockMs: 60_000 },
    });
    expect(result.status).toBe('completed');
    expect(result.finalText).toBe('final answer');
    expect(result.iterations).toBe(2);
  });
});
