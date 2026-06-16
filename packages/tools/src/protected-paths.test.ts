import { describe, expect, test } from 'vitest';
import { HookBus, protectedPathsHook } from './index.js';

describe('protectedPathsHook', () => {
  const root = '/work/b-repo';

  test('allows a write inside the root', async () => {
    const decision = await protectedPathsHook(root)({
      name: 'write_file',
      input: { path: 'src/App.tsx', content: 'x' },
    });
    expect(decision).toBeUndefined();
  });

  test('blocks a relative path that escapes the root via ..', async () => {
    const decision = await protectedPathsHook(root)({
      name: 'write_file',
      input: { path: '../../etc/passwd', content: 'x' },
    });
    expect(decision).toMatchObject({ block: true });
    expect((decision as { reason: string }).reason).toMatch(/outside/i);
  });

  test('blocks an absolute path outside the root', async () => {
    const decision = await protectedPathsHook(root)({
      name: 'write_file',
      input: { path: '/etc/hosts' },
    });
    expect(decision).toMatchObject({ block: true });
  });

  test('ignores tool calls with no path (nothing to protect)', async () => {
    const decision = await protectedPathsHook(root)({
      name: 'search',
      input: { query: 'login' },
    });
    expect(decision).toBeUndefined();
  });

  test('wired into a HookBus, it vetoes only the escaping write', async () => {
    const bus = new HookBus().on('PreToolUse', protectedPathsHook(root));
    const ok = await bus.emit('PreToolUse', { name: 'write_file', input: { path: 'a/b.ts' } });
    const bad = await bus.emit('PreToolUse', { name: 'write_file', input: { path: '/etc/x' } });
    expect(ok).toEqual({ blocked: false });
    expect(bad.blocked).toBe(true);
  });
});
