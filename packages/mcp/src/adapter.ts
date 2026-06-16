import { defineTool, type Tool } from '@loom/tools';
import { z } from 'zod';
import type { McpClient } from './client.js';

/**
 * Adapt an external MCP server's tools (via a connected {@link McpClient}) into
 * `@loom/tools` Tools, so they run through Loom's ToolRegistry + HookBus and get
 * the same permission / audit gating as built-in tools. The external server
 * enforces its own input schema, so the adapted Tool accepts any object and
 * passes it through.
 */
export async function mcpClientTools(client: McpClient): Promise<Tool[]> {
  const infos = await client.listTools();
  return infos.map((info) =>
    defineTool({
      name: info.name,
      description: info.description,
      input: z.record(z.string(), z.unknown()),
      run: (args) => client.callTool(info.name, args),
    }),
  );
}
