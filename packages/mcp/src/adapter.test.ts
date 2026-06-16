import { HookBus, ToolRegistry } from '@loom/tools';
import { describe, expect, test } from 'vitest';
import { McpClient, mcpClientTools, McpServer, memoryTransportPair } from './index.js';

async function adaptedTools() {
  const [a, b] = memoryTransportPair();
  new McpServer({ name: 'svc', version: '0.1.0' })
    .tool({
      name: 'greet',
      description: 'greets someone',
      inputSchema: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] },
      handler: async (args) => ({ hello: (args as { who: string }).who }),
    })
    .connect(a);
  const client = new McpClient(b);
  await client.initialize();
  return mcpClientTools(client);
}

describe('mcpClientTools', () => {
  test('adapts an external MCP server’s tools into @loom/tools Tools', async () => {
    const tools = await adaptedTools();
    expect(tools.map((t) => t.name)).toContain('greet');
  });

  test('calling an adapted tool round-trips to the MCP server', async () => {
    const registry = new ToolRegistry(await adaptedTools());
    const result = await registry.run('greet', { who: 'world' });
    expect(result).toEqual({ hello: 'world' });
  });

  test('adapted tools flow through L1 hooks — a PreToolUse veto blocks them', async () => {
    const hooks = new HookBus().on('PreToolUse', () => ({ block: true, reason: 'not allowed' }));
    const registry = new ToolRegistry(await adaptedTools(), { hooks });
    await expect(registry.run('greet', { who: 'x' })).rejects.toThrow(/not allowed/);
  });
});
