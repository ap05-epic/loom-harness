import { MCP_PROTOCOL_VERSION, type JsonRpcId, type JsonRpcResponse } from './protocol.js';
import type { Transport } from './transport.js';

/** A tool advertised by an MCP server. */
export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * A minimal MCP **client**: speaks JSON-RPC 2.0 over a {@link Transport} to
 * `initialize`, `tools/list`, and `tools/call`. Requests are matched to
 * responses by id, so concurrent calls are safe.
 */
export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();

  constructor(private readonly transport: Transport) {
    transport.onMessage((message) => this.onMessage(message));
  }

  private onMessage(message: unknown): void {
    const res = message as JsonRpcResponse;
    if (!res || res.jsonrpc !== '2.0' || res.id === undefined || res.id === null) return;
    const p = this.pending.get(res.id);
    if (!p) return;
    this.pending.delete(res.id);
    if ('error' in res) p.reject(new Error(res.error.message));
    else p.resolve(res.result);
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async initialize(): Promise<{
    serverInfo: { name: string; version: string };
    capabilities: unknown;
  }> {
    return (await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      clientInfo: { name: 'loom', version: '0.1.0' },
      capabilities: {},
    })) as { serverInfo: { name: string; version: string }; capabilities: unknown };
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.request('tools/list')) as { tools: McpToolInfo[] };
    return result.tools;
  }

  async callTool(name: string, args: unknown): Promise<Record<string, unknown>> {
    return (await this.request('tools/call', { name, arguments: args })) as Record<string, unknown>;
  }
}
