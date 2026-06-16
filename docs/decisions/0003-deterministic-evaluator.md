# ADR 0003 — The evaluator is deterministic and LLM-free

**Status:** Accepted (2026-06-15)

## Context

The harness decides, automatically and at scale, whether a rebuilt screen faithfully matches the original. If that judgement were made by an LLM — especially the same family of model that did the building — it would be vulnerable to the builder "arguing with the judge," to non-determinism, and to reward-hacking (e.g. embedding a screenshot of the legacy screen to fool a vision check). Existing single-agent approaches that self-verify have exactly this weakness.

## Decision

The **`evaluator` package is pure, deterministic, and contains no LLM calls.** It compares two deployments with concrete checks — pixel diff (with masks), DOM/structural diff, computed-style assertions, behavioural replay, accessibility, anti-cheat audits — and produces a machine-readable scorecard with explicit reason codes. It runs against a clean checkout the building agent cannot modify.

## Consequences

- **The judge can be trusted and tested.** It is mutation-tested in both directions: it must pass faithful rebuilds _and_ fail sabotaged ones (a moved control, a missing dropdown option, a wrong validation message, a screenshot-embed cheat), naming the offending screen.
- Because it's pure, the visual core needs no browser to test — synthetic images exercise every branch in CI, fast and deterministically.
- Human judgement is still available where it belongs: a reviewer can approve a per-screen deviation (raising that screen's threshold), but the _default_ is an unforgiving, reproducible gate.
- The evaluator depends only on `core` — never on `agents` — enforcing the separation structurally.
