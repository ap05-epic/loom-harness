import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { defineTool, HookBus, ToolBlockedError, ToolRegistry } from './index.js';

describe('ToolRegistry', () => {
  test('runs a registered tool with schema-validated input', async () => {
    const echo = defineTool({
      name: 'echo',
      description: 'echoes the message back',
      input: z.object({ message: z.string() }),
      run: async (input) => ({ ok: true, output: input.message }),
    });
    const registry = new ToolRegistry([echo]);

    const result = await registry.run('echo', { message: 'hi' });

    expect(result).toEqual({ ok: true, output: 'hi' });
  });

  test('rejects input that fails the schema before the tool body runs', async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const tool = defineTool({
      name: 'needs-string',
      description: 'needs a string message',
      input: z.object({ message: z.string() }),
      run,
    });
    const registry = new ToolRegistry([tool]);

    await expect(registry.run('needs-string', { message: 123 })).rejects.toThrow(/input/i);
    expect(run).not.toHaveBeenCalled();
  });

  test('throws a clear error for an unknown tool', async () => {
    const registry = new ToolRegistry([]);
    await expect(registry.run('nope', {})).rejects.toThrow(/unknown tool: nope/i);
  });
});

describe('ToolRegistry + hooks', () => {
  test('a blocking PreToolUse hook prevents the tool body and throws the reason', async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const tool = defineTool({
      name: 'writer',
      description: 'writes a file',
      input: z.object({}),
      run,
    });
    const hooks = new HookBus();
    hooks.on('PreToolUse', () => ({ block: true, reason: 'path outside b-repo' }));
    const registry = new ToolRegistry([tool], { hooks });

    await expect(registry.run('writer', {})).rejects.toThrow(/path outside b-repo/);
    expect(run).not.toHaveBeenCalled();
  });

  test('a blocked call throws a typed ToolBlockedError carrying the reason', async () => {
    const tool = defineTool({
      name: 'w',
      description: 'x',
      input: z.object({}),
      run: async () => ({ ok: true }),
    });
    const hooks = new HookBus().on('PreToolUse', () => ({ block: true, reason: 'denied: nope' }));
    const registry = new ToolRegistry([tool], { hooks });

    const err = await registry.run('w', {}).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ToolBlockedError);
    expect((err as Error).message).toContain('denied: nope');
  });

  test('PostToolUse sees the result; PostToolUseFailure fires when the tool throws', async () => {
    const events: Array<[string, unknown]> = [];
    const hooks = new HookBus();
    hooks.on('PostToolUse', (p) => {
      events.push(['post', p]);
    });
    hooks.on('PostToolUseFailure', (p) => {
      events.push(['fail', p]);
    });
    const ok = defineTool({
      name: 'ok',
      description: 'succeeds',
      input: z.object({}),
      run: async () => ({ ok: true, v: 1 }),
    });
    const boom = defineTool({
      name: 'boom',
      description: 'throws',
      input: z.object({}),
      run: async () => {
        throw new Error('kaboom');
      },
    });
    const registry = new ToolRegistry([ok, boom], { hooks });

    await registry.run('ok', {});
    await expect(registry.run('boom', {})).rejects.toThrow(/kaboom/);

    expect(events).toEqual([
      ['post', { name: 'ok', input: {}, result: { ok: true, v: 1 } }],
      ['fail', { name: 'boom', input: {}, error: expect.any(Error) }],
    ]);
  });
});
