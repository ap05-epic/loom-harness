/** A single tool invocation requested by the model. */
export type ToolCall = {
  id: string;
  name: string;
  /** Raw JSON string as sent by the model. */
  arguments: string;
};

/** A part of a multimodal user message — text or an image (for vision-capable models like gpt‑5.4). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: Buffer; mime?: string };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/** Flatten message content to plain text (dropping images) — for drivers without vision support. */
export function textOf(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

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
