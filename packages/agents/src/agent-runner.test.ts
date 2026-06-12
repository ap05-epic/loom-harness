import { MockLlmServer } from '@harness/test-kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AgentRunner } from './agent-runner.js';
import { OpenAiDriver } from './drivers/openai-driver.js';
import type { ToolDef } from './types.js';

let server: MockLlmServer;
let baseUrl: string;
beforeEach(async () => {
  server = new MockLlmServer();
  ({ baseUrl } = await server.start());
});
afterEach(async () => {
  await server.stop();
});

const GUARDS = {
  maxIterations: 10,
  maxTokens: 1_000_000,
  maxWallClockMs: 60_000,
  noProgressLimit: 3,
};

function makeRunner(): AgentRunner {
  return new AgentRunner(new OpenAiDriver({ baseUrl, apiKey: 'k' }));
}

const echoTool: ToolDef = {
  name: 'echo',
  description: 'echoes input',
  parameters: { type: 'object', properties: { text: { type: 'string' } } },
  execute: (args) => `echoed:${(args as { text?: string }).text ?? ''}`,
};

describe('AgentRunner', () => {
  test('runs a tool-use loop to completion and returns the final text', async () => {
    server.enqueueToolCall('echo', { text: 'one' });
    server.enqueueText('final answer');

    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'use the tool then answer' }],
      tools: [echoTool],
      guards: GUARDS,
    });

    expect(result.status).toBe('completed');
    expect(result.finalText).toBe('final answer');
    expect(result.iterations).toBe(2);
    // second request must carry the tool result back to the model
    const secondRequest = server.requests[1]?.body.messages as Record<string, unknown>[];
    const toolMsg = secondRequest.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('echoed:one');
  });

  test('tool execution errors are fed back to the model, not thrown', async () => {
    server.enqueueToolCall('boom', {});
    server.enqueueText('recovered');

    const boom: ToolDef = {
      name: 'boom',
      description: 'always fails',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        throw new Error('tool exploded');
      },
    };

    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'go' }],
      tools: [boom],
      guards: GUARDS,
    });
    expect(result.status).toBe('completed');
    const secondRequest = server.requests[1]?.body.messages as Record<string, unknown>[];
    const toolMsg = secondRequest.find((m) => m.role === 'tool');
    expect(String(toolMsg?.content)).toMatch(/tool exploded/);
  });

  test('guard: max iterations trips when the model never finishes', async () => {
    server.enqueueToolCall('echo', { text: 'again' }, { repeat: true });
    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'loop forever' }],
      tools: [echoTool],
      guards: { ...GUARDS, maxIterations: 4, noProgressLimit: 100 },
    });
    expect(result.status).toBe('guard_tripped');
    expect(result.guard).toBe('max_iterations');
    expect(result.iterations).toBe(4);
  });

  test('guard: token budget trips once cumulative usage exceeds the cap', async () => {
    server.enqueueToolCall('echo', { text: 'spend' }, { repeat: true });
    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'spend tokens' }],
      tools: [echoTool],
      guards: { ...GUARDS, maxTokens: 5, noProgressLimit: 100 },
    });
    expect(result.status).toBe('guard_tripped');
    expect(result.guard).toBe('token_budget');
    expect(result.iterations).toBe(1);
  });

  test('guard: no-progress trips on identical consecutive responses', async () => {
    server.enqueueToolCall('echo', { text: 'same' }, { repeat: true });
    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'loop' }],
      tools: [echoTool],
      guards: { ...GUARDS, noProgressLimit: 3 },
    });
    expect(result.status).toBe('guard_tripped');
    expect(result.guard).toBe('no_progress');
    expect(result.iterations).toBe(3);
  });

  test('guard: wall clock trips via injectable clock', async () => {
    server.enqueueToolCall('echo', { text: 'tick' }, { repeat: true });
    let fakeNow = 0;
    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'slow' }],
      tools: [echoTool],
      guards: { ...GUARDS, maxWallClockMs: 100, noProgressLimit: 100 },
      now: () => {
        const t = fakeNow;
        fakeNow += 60; // each check advances 60ms
        return t;
      },
    });
    expect(result.status).toBe('guard_tripped');
    expect(result.guard).toBe('wall_clock');
  });

  test('unknown tool calls are answered with an error result instead of crashing', async () => {
    server.enqueueToolCall('not_registered', {});
    server.enqueueText('ok then');
    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'go' }],
      tools: [echoTool],
      guards: GUARDS,
    });
    expect(result.status).toBe('completed');
    const secondRequest = server.requests[1]?.body.messages as Record<string, unknown>[];
    const toolMsg = secondRequest.find((m) => m.role === 'tool');
    expect(String(toolMsg?.content)).toMatch(/unknown tool/i);
  });

  test('usage is accumulated across iterations in the result', async () => {
    server.enqueueToolCall('echo', { text: 'a' });
    server.enqueueText('done');
    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'go' }],
      tools: [echoTool],
      guards: GUARDS,
    });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.transcript.length).toBeGreaterThanOrEqual(4);
  });
});
