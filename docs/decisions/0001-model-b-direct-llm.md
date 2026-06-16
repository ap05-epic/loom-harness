# ADR 0001 — Model B: the harness owns the agent loop

**Status:** Accepted (2026-06-15)

## Context

The harness needs to drive an LLM through many tool-using steps to build and fix screens. There were two ways to integrate with the model in the target environment, which standardizes on GitHub Copilot as its developer tool:

- **Model A — delegate to Copilot.** Hand a whole task to `copilot -p "…"` and let Copilot's own agent run it. Copilot executes its _own_ tools and returns a result.
- **Model B — own the loop.** The harness calls the model endpoint directly and runs its _own_ agent loop, executing tools we define.

Direct calls to the Azure OpenAI-compatible endpoint were verified to work from the target environment (HTTP 200, egress not blocked). The organization's prior LiteLLM/Claude-Code routing is deprecated.

## Decision

**Model B — the harness owns the agent loop.** The harness runs its _own_ loop with our tools, guards, protected paths, and audit trail; it never delegates the task to Copilot's black-box agent. The model is reached through the `LlmGateway` seam — which transport fills that seam is a separate, swappable choice (see the Update).

## Consequences

- **We keep full control** of the things that make the harness safe and observable: which tools exist, protected paths, the four guards (iterations/tokens/wall-clock/no-progress), budgets, and a complete event/span audit trail. Model A would have ceded all of that to a black box.
- The `LlmGateway` abstraction is retained so the harness stays provider-portable, and the transport is decoupled from the loop.
- We own the agent-loop complexity (already built and tested in `agents/AgentRunner`) rather than inheriting Copilot's behavior — a deliberate, acceptable trade for control and auditability.

## Update (2026-06-15) — Copilot is a first-class transport, and the default

The original wording ("Model B exclusively; no `CopilotCliDriver`") was corrected. **Most developers authenticate to models via a GitHub Copilot _login_ (the VS Code extension / Copilot CLI), not a direct base-URL + key.** A harness that only spoke to a direct endpoint wouldn't run for them.

So the `LlmGateway` now has **two transports**, and the loop (Model B) is unchanged:

- **`CopilotDriver` (default when present).** Drives the authenticated `copilot` CLI headlessly (`copilot -p … --output-format json`). Needs **no `LLM_BASE_URL` / `LLM_API_KEY`** — auth comes from the user's `copilot login` session; the model is selectable. `loom init` defaults to it when the Copilot CLI is detected and no key is set.
- **`OpenAiDriver` (alternative).** The direct BYOK endpoint, for environments that _do_ have a key (e.g. the pod's provider env). Locked to the configured model.

The harness tells the operator which is active (`loom models list` / `doctor`): **Copilot login ⇒ you choose the model; Azure/OpenAI key ⇒ locked to the configured model.** Both go through the same loop, guards, and evaluator. (An Anthropic driver remains for reuse elsewhere.) The agentic "delegate the whole build to `copilot --allow-all-tools`" path remains rejected for the reasons above — Copilot is a completion transport here, not the agent.
