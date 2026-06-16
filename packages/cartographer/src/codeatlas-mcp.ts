import { McpServer } from '@loom/mcp';
import type { CodeAtlas } from './codeatlas.js';
import { repoMap } from './repo-map.js';

/**
 * Expose a {@link CodeAtlas} as an MCP server — so Loom's own agents *and*
 * external tools (Copilot, Claude Code) can query the recovered code map over a
 * standard protocol: the repo-map overview, the screen inventory, one screen's
 * slice, and full-text search.
 */
export function codeAtlasMcpServer(atlas: CodeAtlas, opts: { project?: string } = {}): McpServer {
  const project = opts.project ?? 'project';
  const server = new McpServer({ name: 'codeatlas', version: '0.1.0' });

  server.tool({
    name: 'repo_map',
    description:
      'A compact, PageRank-ordered overview of the whole legacy app — every screen named, under a token budget.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ repoMap: repoMap(atlas, { project }) }),
  });

  server.tool({
    name: 'list_screens',
    description: 'List every screen (action path → its view JSPs and form bean).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ screens: atlas.screens() }),
  });

  server.tool({
    name: 'slice_for_screen',
    description:
      "One screen's full slice: the action, form bean, view JSPs, parsed forms (fields + options), and taglibs.",
    inputSchema: {
      type: 'object',
      properties: { screen: { type: 'string', description: 'Screen key, e.g. login.' } },
      required: ['screen'],
    },
    handler: async (args) => ({
      slice: atlas.sliceForScreen(String((args as { screen: string }).screen)),
    }),
  });

  server.tool({
    name: 'search',
    description: 'Full-text search the code graph (BM25-ranked) by term.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Max results (default 50).' },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const a = args as { query: string; limit?: number };
      return { results: atlas.search(String(a.query), { limit: a.limit }) };
    },
  });

  return server;
}
