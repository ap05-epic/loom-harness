# Adding an LLM driver

A driver adapts one provider's API to the harness's `LlmGateway`. The agent loop and guards are provider-agnostic, so a driver only does request/response mapping.

## Implement the interface

```ts
import type { LlmGateway, LlmRequest, LlmResponse } from '@loom/agents';

export class MyDriver implements LlmGateway {
  async complete(request: LlmRequest): Promise<LlmResponse> {
    // 1. map request.messages + request.tools to the provider's wire format
    // 2. POST it (respect a configurable baseUrl so it can be stubbed in tests)
    // 3. map the response back to { content, toolCalls, usage, finishReason }
  }
}
```

The contract that matters:

- **`toolCalls`** in the response are _requests_ the harness will execute — the driver must surface them, not act on them. Return `{ id, name, arguments }` (arguments as a JSON string).
- **Round-trip tool history**: an assistant message may carry `toolCalls`, and a `tool` message carries a `toolCallId` + result. Map both into the provider's format (e.g. Anthropic's `tool_use` / `tool_result` blocks).
- **Usage**: map the provider's token counts into `{ inputTokens, outputTokens }` so budgets and cost work.

## Make the mapping pure

Export the request-builder and response-parser as pure functions (as the Anthropic driver does with `buildAnthropicRequest` / `parseAnthropicResponse`). They carry all the logic and are trivially unit-testable.

## Prove conformance

Beyond unit tests on the mappers, drive a full `AgentRunner` tool loop through your driver against a stub endpoint that returns a tool call then a final text — exactly as `anthropic-driver.test.ts` does. That demonstrates the driver satisfies the gateway contract end-to-end.

## Wire it in

Add the driver to the gateway factory / the profile's `llm.driver` options, and document the new value in [reference/configuration.md](../../reference/configuration.md).
