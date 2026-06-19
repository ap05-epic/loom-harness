import { MockLlmServer } from '@loom/test-kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AgentRunner } from './agent-runner.js';
import { OpenAiDriver } from './drivers/openai-driver.js';
import type { ChatMessage, LlmGateway, ToolDef } from './types.js';

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

  test('caps an oversized tool result to maxToolOutputChars (context hygiene)', async () => {
    const huge = 'x'.repeat(5000);
    const dump: ToolDef = {
      name: 'dump',
      description: 'returns a lot',
      parameters: { type: 'object', properties: {} },
      execute: () => huge,
    };
    server.enqueueToolCall('dump', {});
    server.enqueueText('done');

    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'go' }],
      tools: [dump],
      guards: GUARDS,
      maxToolOutputChars: 200,
    });

    const toolMsg = result.transcript.find((m) => m.role === 'tool')!;
    expect(toolMsg.content!.length).toBeLessThan(huge.length); // capped
    expect(toolMsg.content).toContain('truncated');
    // …and the model was sent the capped version, not the 5000-char blob.
    const secondRequest = server.requests[1]?.body.messages as Record<string, unknown>[];
    expect(String(secondRequest.find((m) => m.role === 'tool')?.content)).toContain('truncated');
  });

  test('leaves a small tool result intact (no truncation marker)', async () => {
    server.enqueueToolCall('echo', { text: 'one' });
    server.enqueueText('done');
    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'go' }],
      tools: [echoTool],
      guards: GUARDS,
      maxToolOutputChars: 1000,
    });
    expect(result.transcript.find((m) => m.role === 'tool')!.content).toBe('echoed:one');
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

  test('a malformed tool-call argument is reported as an arguments error and the tool is not run', async () => {
    let executed = false;
    const echo: ToolDef = {
      name: 'echo',
      description: 'echoes',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
      execute: () => {
        executed = true;
        return 'ran';
      },
    };
    let i = 0;
    const gw: LlmGateway = {
      complete: () => {
        i += 1;
        if (i === 1) {
          return Promise.resolve({
            content: null,
            toolCalls: [{ id: 'c1', name: 'echo', arguments: '{not valid json' }],
            usage: { inputTokens: 1, outputTokens: 1 },
            finishReason: 'tool_calls',
          });
        }
        return Promise.resolve({
          content: 'ok then',
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: 'stop',
        });
      },
    };
    const result = await new AgentRunner(gw).run({
      model: 'm',
      messages: [{ role: 'user', content: 'go' }],
      tools: [echo],
      guards: GUARDS,
    });
    expect(result.status).toBe('completed');
    expect(executed).toBe(false); // a tool with unparseable args must not run
    const toolMsg = result.transcript.find((m) => m.role === 'tool');
    expect(String(toolMsg?.content)).toMatch(/invalid json arguments/i); // a clear, actionable repair message
  });

  test('onStep fires once per assistant message, with content + tool calls, before tool execution', async () => {
    server.enqueueToolCall('echo', { text: 'one' });
    server.enqueueText('final answer');
    const steps: ChatMessage[] = [];
    const result = await makeRunner().run({
      model: 'm',
      messages: [{ role: 'user', content: 'go' }],
      tools: [echoTool],
      guards: GUARDS,
      onStep: (m) => steps.push(m),
    });
    expect(result.status).toBe('completed');
    // one step for the tool-call turn, one for the final-text turn — so a UI can stream each
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ role: 'assistant' });
    expect(steps[0]?.role === 'assistant' && steps[0].toolCalls?.[0]?.name).toBe('echo');
    expect(steps[1]).toMatchObject({ role: 'assistant', content: 'final answer' });
  });
});
