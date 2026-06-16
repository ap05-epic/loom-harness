import type { ChatMessage, LlmGateway, LlmRequest, LlmResponse, ToolCall } from '../types.js';

export type OpenAiDriverOptions = {
  /** Base URL including the version segment, e.g. https://host/openai/v1 or http://127.0.0.1:8080/v1 */
  baseUrl: string;
  apiKey: string;
  /** Extra headers, e.g. corporate gateway requirements. */
  headers?: Record<string, string>;
};

type WireMessage = Record<string, unknown>;

type WireResponse = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function toWireMessage(message: ChatMessage): WireMessage {
  switch (message.role) {
    case 'system':
    case 'user':
      return { role: message.role, content: message.content };
    case 'assistant': {
      const wire: WireMessage = { role: 'assistant', content: message.content };
      if (message.toolCalls?.length) {
        wire.tool_calls = message.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      return wire;
    }
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
}

/**
 * Driver for any OpenAI-compatible chat-completions endpoint (OpenAI, Azure
 * OpenAI v1 surface, corporate gateways, the test-kit mock). Sends both
 * `Authorization: Bearer` and `api-key` headers so OpenAI- and Azure-style
 * auth both work without configuration.
 */
export class OpenAiDriver implements LlmGateway {
  constructor(private readonly options: OpenAiDriverOptions) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(toWireMessage),
    };
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (request.maxTokens !== undefined) {
      body.max_completion_tokens = request.maxTokens;
    }

    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
        'api-key': this.options.apiKey,
        ...this.options.headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed (HTTP ${response.status}): ${errorText}`);
    }

    const json = (await response.json()) as WireResponse;
    const choice = json.choices?.[0];
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content: choice?.message?.content ?? null,
      toolCalls,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      finishReason: choice?.finish_reason ?? 'unknown',
    };
  }
}
