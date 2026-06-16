import type { LlmGateway, LlmRequest, LlmResponse, ToolCall } from '../types.js';

export type AnthropicDriverOptions = {
  apiKey: string;
  /** Base URL (default https://api.anthropic.com); point at a LiteLLM proxy if desired. */
  baseUrl?: string;
  anthropicVersion?: string;
  headers?: Record<string, string>;
};

type TextBlock = { type: 'text'; text: string };
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string };
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

type AnthropicMessage = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

export type AnthropicRequestBody = {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: { name: string; description: string; input_schema: Record<string, unknown> }[];
};

const DEFAULT_MAX_TOKENS = 4096;

/** Map the provider-agnostic request to an Anthropic Messages API body (pure). */
export function buildAnthropicRequest(request: LlmRequest): AnthropicRequestBody {
  const systemParts: string[] = [];
  const messages: AnthropicMessage[] = [];

  for (const message of request.messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    if (message.role === 'user') {
      messages.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const blocks: ContentBlock[] = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments ? JSON.parse(call.arguments) : {},
        });
      }
      messages.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (message.role === 'tool') {
      // tool result — merge into the previous user message if it already holds tool_results
      const block: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        messages.push({ role: 'user', content: [block] });
      }
    }
  }

  const body: AnthropicRequestBody = {
    model: request.model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages,
  };
  if (systemParts.length) body.system = systemParts.join('\n\n');
  if (request.tools?.length) {
    body.tools = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }
  return body;
}

type AnthropicResponse = {
  content?: ContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** Parse an Anthropic Messages API response into the provider-agnostic shape (pure). */
export function parseAnthropicResponse(json: AnthropicResponse): LlmResponse {
  let content: string | null = null;
  const toolCalls: ToolCall[] = [];
  for (const block of json.content ?? []) {
    if (block.type === 'text') content = (content ?? '') + block.text;
    else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
    }
  }
  return {
    content,
    toolCalls,
    usage: {
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
    },
    finishReason: json.stop_reason ?? 'unknown',
  };
}

/** LlmGateway driver for the Anthropic Messages API (direct HTTP, no SDK dependency). */
export class AnthropicDriver implements LlmGateway {
  constructor(private readonly options: AnthropicDriverOptions) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const base = (this.options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    const response = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.options.apiKey,
        'anthropic-version': this.options.anthropicVersion ?? '2023-06-01',
        ...this.options.headers,
      },
      body: JSON.stringify(buildAnthropicRequest(request)),
    });
    if (!response.ok) {
      throw new Error(
        `Anthropic request failed (HTTP ${response.status}): ${await response.text()}`,
      );
    }
    return parseAnthropicResponse((await response.json()) as AnthropicResponse);
  }
}
