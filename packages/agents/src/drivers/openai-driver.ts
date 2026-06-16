import type { ChatMessage, LlmGateway, LlmRequest, LlmResponse, ToolCall } from '../types.js';

export type OpenAiDriverOptions = {
  /** Base URL including the version segment, e.g. https://host/openai/v1 or http://127.0.0.1:8080/v1 */
  baseUrl: string;
  apiKey: string;
  /** Extra headers, e.g. corporate gateway requirements. */
  headers?: Record<string, string>;
  /** Retry transient failures (429 / 5xx / network) this many times (default 1). */
  maxRetries?: number;
  /** Base backoff between retries, in ms (default 500). Tests pass 0. */
  retryDelayMs?: number;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Honour a `Retry-After` header (seconds) when present; else null. */
function retryAfterMs(response: Response): number | null {
  const h = response.headers.get('retry-after');
  if (!h) return null;
  const secs = Number(h);
  return Number.isFinite(secs) ? secs * 1000 : null;
}

/** Turn an HTTP failure into an actionable message — the pod operator's first clue. */
export function classifyOpenAiError(status: number, body: string): string {
  const detail = body.trim().slice(0, 400);
  if (status === 401 || status === 403) {
    return `LLM auth failed (HTTP ${status}) — check LLM_API_KEY (and that it matches this endpoint). ${detail}`;
  }
  if (status === 404) {
    return `LLM endpoint/model not found (HTTP 404) — check the model id and that LLM_BASE_URL includes the version path (…/openai/v1). ${detail}`;
  }
  if (status === 429) {
    return `LLM rate-limited (HTTP 429) — slow down or check your quota. ${detail}`;
  }
  if (status >= 500) {
    return `LLM server error (HTTP ${status}) — the endpoint failed; retry later. ${detail}`;
  }
  return `LLM request failed (HTTP ${status}): ${detail}`;
}

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

    const url = `${base}/chat/completions`;
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
        'api-key': this.options.apiKey,
        ...this.options.headers,
      },
      body: JSON.stringify(body),
    };

    const maxRetries = this.options.maxRetries ?? 1;
    const baseDelay = this.options.retryDelayMs ?? 500;

    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (error) {
        // Transient network/proxy failure — retry once, then surface an actionable message.
        if (attempt <= maxRetries) {
          await sleep(baseDelay * attempt);
          continue;
        }
        throw new Error(
          `LLM request failed (network error) — check LLM_BASE_URL and that NO_PROXY covers the LLM host: ${String(error)}`,
        );
      }

      if (response.ok) {
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

      const errorText = await response.text();
      const transient = response.status === 429 || response.status >= 500;
      if (transient && attempt <= maxRetries) {
        await sleep(retryAfterMs(response) ?? baseDelay * attempt);
        continue;
      }
      throw new Error(classifyOpenAiError(response.status, errorText));
    }
  }
}
