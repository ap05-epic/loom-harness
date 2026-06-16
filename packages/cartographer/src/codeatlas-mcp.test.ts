import { McpClient, memoryTransportPair } from '@loom/mcp';
import { describe, expect, test } from 'vitest';
import { codeAtlasMcpServer } from './codeatlas-mcp.js';
import { openCodeAtlas } from './codeatlas.js';

async function wiredClient(): Promise<McpClient> {
  const atlas = openCodeAtlas(':memory:');
  const action = atlas.ensureNode('action', '/login', undefined, {
    type: 'com.example.legacy.web.action.LoginAction',
  });
  const jsp = atlas.ensureNode('jsp', 'login.jsp', 'jsp/login.jsp', {
    forms: [],
    taglibs: ['html'],
  });
  atlas.addEdge(action, jsp, 'renders');

  const [a, b] = memoryTransportPair();
  codeAtlasMcpServer(atlas, { project: 'fixture' }).connect(a);
  const client = new McpClient(b);
  await client.initialize();
  return client;
}

describe('codeAtlasMcpServer', () => {
  test('advertises the atlas query tools', async () => {
    const client = await wiredClient();
    const names = (await client.listTools()).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['repo_map', 'list_screens', 'slice_for_screen', 'search']),
    );
  });

  test('list_screens returns the screen inventory', async () => {
    const client = await wiredClient();
    const res = await client.callTool('list_screens', {});
    const keys = (res.screens as Array<{ key: string }>).map((s) => s.key);
    expect(keys).toContain('login');
  });

  test('slice_for_screen returns one screen slice', async () => {
    const client = await wiredClient();
    const res = await client.callTool('slice_for_screen', { screen: 'login' });
    expect((res.slice as { action: { name: string } }).action.name).toBe('/login');
  });

  test('search finds nodes by term', async () => {
    const client = await wiredClient();
    const res = await client.callTool('search', { query: 'login' });
    expect((res.results as unknown[]).length).toBeGreaterThan(0);
  });

  test('repo_map returns a non-empty overview string', async () => {
    const client = await wiredClient();
    const res = await client.callTool('repo_map', {});
    expect(typeof res.repoMap).toBe('string');
    expect((res.repoMap as string).length).toBeGreaterThan(0);
  });
});
