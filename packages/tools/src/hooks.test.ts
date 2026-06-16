import { describe, expect, test, vi } from 'vitest';
import { HookBus } from './index.js';

describe('HookBus', () => {
  test('runs hooks in registration order until one blocks (terminal)', async () => {
    const calls: string[] = [];
    const bus = new HookBus();
    bus.on('PreToolUse', () => {
      calls.push('a'); // allow (returns void)
    });
    bus.on('PreToolUse', () => {
      calls.push('b');
      return { block: true, reason: 'nope' };
    });
    bus.on('PreToolUse', () => {
      calls.push('c'); // must NOT run — a prior hook was terminal
    });

    const decision = await bus.emit('PreToolUse', {});

    expect(decision).toEqual({ blocked: true, reason: 'nope' });
    expect(calls).toEqual(['a', 'b']);
  });

  test('returns not-blocked when every hook allows', async () => {
    const bus = new HookBus();
    bus.on('SessionStart', () => {});
    expect(await bus.emit('SessionStart', {})).toEqual({ blocked: false });
  });

  test('emitting an event with no registered hooks is allowed', async () => {
    const bus = new HookBus();
    expect(await bus.emit('before_compaction', {})).toEqual({ blocked: false });
  });

  test('passes the payload to each hook', async () => {
    const bus = new HookBus();
    const seen = vi.fn();
    bus.on('PostToolUse', (p) => {
      seen(p);
    });
    await bus.emit('PostToolUse', { name: 'echo', result: { ok: true } });
    expect(seen).toHaveBeenCalledWith({ name: 'echo', result: { ok: true } });
  });
});
