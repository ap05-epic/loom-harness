import { describe, expect, test } from 'vitest';
import { mcpChatTools, type McpLike } from './mcp-tools.js';

describe('mcpChatTools', () => {
  test('adapts an MCP server’s tools into chat tools that proxy to callTool', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const client: McpLike = {
      listTools: async () => [
        {
          name: 'browser_navigate',
          description: 'navigate to a url',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url'],
          },
        },
      ],
      callTool: async (name, args) => {
        calls.push({ name, args });
        return { ok: true, url: (args as { url: string }).url };
      },
    };

    const tools = await mcpChatTools(client);
    expect(tools).toHaveLength(1);
    const t = tools[0]!;
    expect(t.def.name).toBe('browser_navigate');
    expect(t.def.description).toContain('navigate');
    // the MCP inputSchema becomes the tool's parameters verbatim
    expect(t.def.parameters).toEqual({
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    });
    // MCP tools mutate the outside world → gated as expensive
    expect(t.risk).toBe('expensive');

    const out = await t.def.execute({ url: 'http://app.test/' });
    expect(calls).toEqual([{ name: 'browser_navigate', args: { url: 'http://app.test/' } }]);
    expect(out).toContain('http://app.test/'); // the result is stringified back to the model
  });

  test('namespaces tool names when a prefix is given (avoids collisions across servers)', async () => {
    const client: McpLike = {
      listTools: async () => [{ name: 'search', description: 'docs', inputSchema: {} }],
      callTool: async () => ({}),
    };
    const tools = await mcpChatTools(client, { prefix: 'context7' });
    expect(tools[0]!.def.name).toBe('context7__search');
  });
});
