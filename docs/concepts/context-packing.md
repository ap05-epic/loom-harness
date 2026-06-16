# Context packing

A coding agent can't be handed "the whole codebase." The **context packer** assembles a per-work-package _work order_ sized to whatever model is active — the same code serves 128K through 1M+ windows.

## Budgets are ratios, not constants

`computeBudgets(profile)` derives everything from the model's window:

- **work order** ≤ 25% of the window (floored at 24K, capped at 120K — a bigger model gets richer slices and more history, never a code dump)
- **compaction** triggers at 88% of the window (summarize-and-continue, keeping the head pinned)
- **per-turn output** = `min(16K, maxOutput / 4)`

For GPT-5.4 (272K/128K) that yields a ~68K work order, compaction at ~240K, 16K output — the plan's defaults, asserted in tests at 128K / 200K / 272K / 1M.

## Token counting, with a fallback

`counterFor(tokenizer)` returns a counter for the model's tokenizer family — precise (`gpt-tokenizer`, lazily loaded) for OpenAI-family models, and a conservative heuristic (`chars × 11 / 40`) otherwise or if the encoder isn't installed. The harness never hard-fails on a missing tokenizer.

## The shrink ladder

`packWorkOrder(slots, …)` fills slots **most-important-first** under the budget:

- Each slot declares a priority, a `shrink` strategy (`keep` / `truncate` / `drop`), an optional `requiresVision`, and an optional per-slot `maxTokens` cap.
- The **task spec is never truncated** (priority 0, `keep`).
- A `truncate` slot is cut to its cap-or-remaining budget using efficient sample-based truncation (it never counts a huge string repeatedly).
- A per-slot `maxTokens` cap stops one big slot from starving later ones (so a giant source file can't crowd out the screenshots).
- **Vision-aware degradation:** screenshot slots are dropped for non-vision models, and the packer leans on denser text instead.

The result is a packed work order plus a per-slot report (`full` / `truncated` / `dropped`) — and the budget the model didn't get is reachable on demand through the atlas MCP servers. The packer's job is a good cold start, not completeness.

## Builder work-order slots

In priority order: task spec + gates · screen doc · relevant skills · memory (project facts + worklog) · legacy source slice · normalized DOM · style digest · form/nav schema · API contract · conventions · prior-attempt feedback · target-repo digest · screenshots (vision only).

## Cache-stable assembly

Providers cache the longest **byte-stable prefix** of a prompt, so the harness keeps that prefix fixed:

- **Bootstrap identity + safeguards.** `buildSystemPrompt(role)` heads every agent's system prompt with a fixed `LOOM_IDENTITY` + `LOOM_SAFEGUARDS` preamble (the "bootstrap files", injected once) and only then the role-specific task. It is deterministic — no timestamps or volatile content — so the preamble is identical call to call and **shared across roles**, maximizing the cacheable span. The Builder's system prompt is a module-level constant, byte-stable across every attempt and screen.
- **Frozen work order.** Within an attempt the initial messages don't change; the agent loop only _appends_ tool results, so the cached prefix survives every turn.
- **Tool-output hygiene.** The agent loop caps each tool result at `maxToolOutputChars` (Builder default 20k) before it enters the transcript, so one runaway output can't blow the window or push the cached prefix out.

Together with [memory consolidation](skills-and-memory.md) (which keeps the recalled fact set bounded), this keeps long unattended shifts both cheap (cache hits) and stable (bounded context).
