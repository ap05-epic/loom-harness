import { z } from 'zod';
import { describe, expect, test } from 'vitest';
import { defineTool, namespacedToolName, scopeTools } from './tools.js';

describe('tool namespacing (per-project isolation)', () => {
  test('namespacedToolName prefixes a tool name by project', () => {
    expect(namespacedToolName('baa', 'supabase.query')).toBe('baa__supabase.query');
  });

  test('scopeTools prefixes every tool, leaves the originals intact, and never collides across projects', () => {
    const tool = defineTool({
      name: 'query',
      description: 'run a query',
      input: z.object({}),
      run: async () => ({}),
    });

    const [scoped] = scopeTools('baa', [tool]);
    expect(scoped!.name).toBe('baa__query');
    expect(tool.name).toBe('query'); // the source tool is unchanged
    // two projects scoping the same source tool get distinct names ⇒ no registry collision
    expect(scopeTools('a', [tool])[0]!.name).not.toBe(scopeTools('b', [tool])[0]!.name);
  });
});
