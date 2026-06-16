# @loom/agents

The LLM-facing layer: a provider-neutral gateway, a guarded agent loop, model profiles, and the model-adaptive context packer. Implements **Model B** — the harness runs its own loop (see [ADR 0001](../../docs/decisions/0001-model-b-direct-llm.md)).

## What it provides

- **`LlmGateway`** — one interface, swappable drivers (same loop, different transport):
  - `CopilotDriver` — drives the authenticated **GitHub Copilot CLI** (`copilot -p … --output-format json`). **No base URL or key** — auth is the user's `copilot login` session, and the model is selectable. The default for the many devs who have a Copilot login but no direct key. Pure mappers (`renderCopilotPrompt`/`parseCopilotResponse`/`classifyCopilotError`) + an injectable spawn seam + `detectCopilot()`; conformance-tested against a stubbed binary (no live login).
  - `OpenAiDriver` — any OpenAI-compatible endpoint (OpenAI, Azure, gateways). Sends both `Authorization: Bearer` and `api-key` headers so Azure auth works unconfigured. The direct **BYOK key** path (e.g. the pod).
  - `AnthropicDriver` — the Anthropic Messages API (direct HTTP), kept for portability elsewhere. Pure request/response mappers are exported and unit-tested.
- **`AgentRunner`** — the inner loop: model ⇄ tools until the model answers, bounded by four hard **guards** (max iterations, token budget, wall-clock, no-progress detection). Tool failures are fed back to the model, never thrown.
- **`resolveModelProfile(id, overrides?)`** — maps a model id to its capabilities (context window, max output, vision, tokenizer family); the basis for model-adaptive behavior.
- **`ContextPacker`** — given a `ModelProfile`, derives budgets as ratios of the window (validated 128K → 1M+), counts tokens for the right tokenizer (with a heuristic fallback), and packs work-order _slots_ with a shrink ladder: the task spec is never truncated, per-slot caps stop one slot starving others, and screenshot slots are dropped for non-vision models. See [concept](../../docs/concepts/context-packing.md).

## Example

```ts
import { OpenAiDriver, AgentRunner, ContextPacker, resolveModelProfile } from '@loom/agents';

const runner = new AgentRunner(new OpenAiDriver({ baseUrl, apiKey }));
const result = await runner.run({
  model: 'gpt-5.4',
  messages: [{ role: 'user', content: 'use the tool then answer' }],
  tools: [echoTool],
  guards: { maxIterations: 25, maxTokens: 200_000, maxWallClockMs: 600_000 },
});

const packer = new ContextPacker(resolveModelProfile('gpt-5.4'));
const order = packer.pack(slots); // assembled work order within budget
```

## Tested

Drivers are tested against the `test-kit` mock server and stub endpoints (including a full `AgentRunner` loop through _both_ OpenAI and Anthropic drivers — driver-agnostic conformance). The context packer's budgets, token counting, and shrink ladder are unit-tested.
