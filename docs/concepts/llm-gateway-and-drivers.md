# The LLM gateway & drivers

The harness talks to models through one interface, `LlmGateway`, and runs **its own** agent loop on top (Model B — [ADR 0001](../decisions/0001-model-b-direct-llm.md)).

## The interface

```ts
interface LlmGateway {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
```

`complete` is a single turn: given messages and optional tool schemas, return the model's text and/or **tool-call requests**. Crucially, the gateway does _not_ execute tools — the `AgentRunner` does. That's what keeps tool execution, protected paths, and guards under the harness's control.

## Drivers

The loop is the same; only the **transport** differs. Pick one with `llm.driver`.

- **`OpenAiDriver`** (the default and only active driver) — any OpenAI-compatible endpoint, including the Azure `…/openai/v1` surface. Maps our request to the chat-completions wire format, parses tool calls back, and sends both `Authorization: Bearer` and `api-key` headers so OpenAI- and Azure-style auth both work. Maps `maxTokens → max_completion_tokens`; classifies 401/404/429 with actionable messages and retries a transient failure once.
- **`AnthropicDriver`** (portability) — the Anthropic Messages API over direct HTTP: lifts system messages, maps tool calls to `tool_use`/`tool_result` blocks, sets the required `max_tokens`.
- **`CopilotDriver`** (shipped but **disabled**) — drives the GitHub Copilot CLI headlessly; kept in the tree for reference but no longer constructed on any runtime path. The agentic chat needs tool-calling, which the Copilot CLI doesn't surface, so Loom is OpenAI/Azure-only.

**Which is active, and can I choose the model?** `loom models list` / `doctor` say so plainly: the model is **fixed to the configured `llm.model`** by your key/endpoint. `loom init` writes `driver: openai`.

Adding another transport is small and well-trodden — see [Adding an LLM driver](../guides/extending/adding-an-llm-driver.md).

## The agent loop & guards

`AgentRunner.run()` drives `complete` ⇄ tools until the model answers with text, bounded by four hard guards so an autonomous run can never thrash or run away:

| Guard            | Trips when                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `max_iterations` | too many turns without finishing                                                                  |
| `token_budget`   | cumulative tokens exceed the cap                                                                  |
| `wall_clock`     | the run exceeds its time budget                                                                   |
| `no_progress`    | the model repeats an identical response N times (hashed on _semantic_ content, not tool-call ids) |

Tool errors are captured and returned to the model as tool results, never thrown — the model gets a chance to recover.

## Model profiles

`resolveModelProfile(id)` returns a model's `{ contextWindow, maxOutput, vision, tokenizer }`. This single source of truth drives the [context packer](context-packing.md) and lets the same harness run unchanged from a 128K model to a 1M-window one.
