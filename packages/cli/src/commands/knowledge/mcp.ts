import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';

type ServerRow = { name: string; command: string; args: string };

export const mcpListCommand = defineCommand({
  name: 'mcp list',
  group: 'knowledge',
  describe: 'List the external MCP servers declared in the profile',
  exitCodes: ['CONFIG'],
  examples: ['loom mcp list', 'loom mcp list --json'],
  run(ctx) {
    const profile = ctx.requireProfile();
    const servers: ServerRow[] = (profile.mcp?.servers ?? []).map((s) => ({
      name: s.name,
      command: s.command,
      args: (s.args ?? []).join(' '),
    }));
    return { servers };
  },
  render(data, ctx) {
    const d = data as { servers: ServerRow[] };
    if (d.servers.length === 0) {
      ctx.sink.line('No MCP servers configured — add an `mcp.servers:` block to loom.config.yaml.');
      return;
    }
    ctx.sink.line(
      renderTable(d.servers, [
        { key: 'name', header: 'NAME' },
        { key: 'command', header: 'COMMAND' },
        { key: 'args', header: 'ARGS' },
      ]),
    );
  },
});
