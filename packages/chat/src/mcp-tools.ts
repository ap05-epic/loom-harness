import { tool, type ChatTool } from './session.js';

/**
 * The minimal shape of a connected MCP client this adapter needs — `@loom/mcp`'s `McpClient` satisfies
 * it structurally, so `@loom/chat` stays free of an `@loom/mcp` dependency (the host owns the
 * connection/transport and passes the client in).
 */
export type McpLike = {
  listTools(): Promise<
    Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
  >;
  callTool(name: string, args: unknown): Promise<unknown>;
};

/**
 * Adapt a connected MCP server's tools into {@link ChatTool}s so they join the chat agent's toolset
 * (e.g. Playwright to drive the legacy app, Context7 for current library docs). The server's
 * JSON-Schema `inputSchema` becomes the tool's parameters; every call routes back through the MCP
 * client and is gated `expensive` (it mutates the outside world). `prefix` namespaces the names so
 * two servers can't collide. The host passes the result via `buildChatTools(session, { extraTools })`.
 */
export async function mcpChatTools(
  client: McpLike,
  opts: { prefix?: string } = {},
): Promise<ChatTool[]> {
  const infos = await client.listTools();
  return infos.map((info) =>
    tool(
      opts.prefix ? `${opts.prefix}__${info.name}` : info.name,
      info.description || `MCP tool ${info.name}`,
      info.inputSchema && typeof info.inputSchema === 'object'
        ? info.inputSchema
        : { type: 'object', properties: {}, additionalProperties: true },
      'expensive',
      async (args) => {
        // Call the server's original (un-prefixed) tool name.
        const result = await client.callTool(info.name, args);
        return typeof result === 'string' ? result : JSON.stringify(result);
      },
    ),
  );
}
