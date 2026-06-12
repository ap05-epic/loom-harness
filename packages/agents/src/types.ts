/** A single tool invocation requested by the model. */
export type ToolCall = {
  id: string;
  name: string;
  /** Raw JSON string as sent by the model. */
  arguments: string;
};

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/** JSON-schema-shaped tool declaration, provider-agnostic. */
export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** A tool the AgentRunner can execute locally. */
export type ToolDef = ToolSchema & {
  execute: (args: unknown) => string | Promise<string>;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
};

export type LlmRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  maxTokens?: number;
};

export type LlmResponse = {
  content: string | null;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: string;
};

/** The single seam every model provider implements. */
export interface LlmGateway {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
