import {
  JSONRPC_INTERNAL_ERROR,
  MCP_PROTOCOL_VERSION,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol.js';
import type { Transport } from './transport.js';

/** A tool's handler: takes validated args, returns a structured result. */
export type McpToolHandler = (args: unknown) => Promise<Record<string, unknown>>;

/** A tool exposed by an MCP server (name + JSON-Schema input + handler). */
export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: McpToolHandler;
};

/**
 * A minimal MCP **server**: registers tools and answers `initialize`,
 * `tools/list`, and `tools/call` over any {@link Transport}. Dependency-free
 * (JSON-RPC 2.0 by hand) to keep the air-gapped pod install lean.
 *
 * NOTE: `tools/call` returns the handler's structured result directly — the
 * Loom-internal envelope. Wrapping it in MCP's `{ content: [...] }` shape for
 * external (Copilot / Claude Code) interop is a later refinement.
 */
export class McpServer {
  private readonly tools = new Map<string, McpToolDef>();

  constructor(private readonly info: { name: string; version: string }) {}

  tool(def: McpToolDef): this {
    this.tools.set(def.name, def);
    return this;
  }

  connect(transport: Transport): void {
    transport.onMessage((message) => {
      void this.handle(message, transport);
    });
  }

  private async handle(message: unknown, transport: Transport): Promise<void> {
    const req = message as JsonRpcRequest;
    if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') return;
    const reply = (response: JsonRpcResponse): void => transport.send(response);
    try {
      const result = await this.dispatch(req.method, req.params);
      if (req.id !== undefined) reply({ jsonrpc: '2.0', id: req.id, result });
    } catch (error) {
      const message_ = error instanceof Error ? error.message : String(error);
      if (req.id !== undefined) {
        reply({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: JSONRPC_INTERNAL_ERROR, message: message_ },
        });
      }
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: this.info,
          capabilities: { tools: {} },
        };
      case 'tools/list':
        return {
          tools: [...this.tools.values()].map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        };
      case 'tools/call': {
        const p = (params ?? {}) as { name?: string; arguments?: unknown };
        const tool = p.name ? this.tools.get(p.name) : undefined;
        if (!tool) throw new Error(`unknown tool: ${p.name}`);
        return tool.handler(p.arguments ?? {});
      }
      default:
        throw new Error(`unknown method: ${method}`);
    }
  }
}
