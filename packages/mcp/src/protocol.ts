/** The MCP protocol revision this kit speaks. */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

export type JsonRpcId = number | string;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcSuccess = { jsonrpc: '2.0'; id: JsonRpcId; result: unknown };

export type JsonRpcError = {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
};

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** Standard JSON-RPC error codes used by the kit. */
export const JSONRPC_INTERNAL_ERROR = -32000;
