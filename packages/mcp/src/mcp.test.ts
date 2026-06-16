import { describe, expect, test } from 'vitest';
import { McpClient, McpServer, memoryTransportPair } from './index.js';

describe('memoryTransportPair', () => {
  test('delivers messages between both ends', () => {
    const [a, b] = memoryTransportPair();
    const onA: unknown[] = [];
    const onB: unknown[] = [];
    a.onMessage((m) => onA.push(m));
    b.onMessage((m) => onB.push(m));

    a.send({ from: 'a' });
    b.send({ from: 'b' });

    expect(onB).toEqual([{ from: 'a' }]);
    expect(onA).toEqual([{ from: 'b' }]);
  });
});

describe('McpServer + McpClient', () => {
  function wired(): { server: McpServer; client: McpClient } {
    const [a, b] = memoryTransportPair();
    const server = new McpServer({ name: 'atlas', version: '0.1.0' });
    server.tool({
      name: 'echo',
      description: 'echoes the message',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      handler: async (args) => ({ said: (args as { message: string }).message }),
    });
    server.connect(a);
    return { server, client: new McpClient(b) };
  }

  test('initialize returns the server info', async () => {
    const { client } = wired();
    const info = await client.initialize();
    expect(info.serverInfo).toEqual({ name: 'atlas', version: '0.1.0' });
  });

  test('listTools returns the registered tools with their schemas', async () => {
    const { client } = wired();
    await client.initialize();
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'echo', description: 'echoes the message' });
    expect(tools[0]!.inputSchema).toMatchObject({ type: 'object' });
  });

  test('callTool runs the handler and returns its result', async () => {
    const { client } = wired();
    await client.initialize();
    const result = await client.callTool('echo', { message: 'hi' });
    expect(result).toEqual({ said: 'hi' });
  });

  test('calling an unknown tool rejects with an MCP error', async () => {
    const { client } = wired();
    await client.initialize();
    await expect(client.callTool('nope', {})).rejects.toThrow(/unknown tool: nope/i);
  });
});
