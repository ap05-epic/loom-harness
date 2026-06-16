# Loom Harness — Documentation

Start here. The docs are organized by intent:

## Understand it

- [Architecture](architecture.md) — the system at a glance: the pipeline, the subsystems, the data stores, how a screen flows from legacy to a verified rebuild.
- [Concepts](concepts/) — the "why and how" behind each idea:
  - [Profiles](concepts/profiles.md) — how a project is described to the harness
  - [LLM gateway & drivers](concepts/llm-gateway-and-drivers.md) — Model B, the provider abstraction
  - [Context packing](concepts/context-packing.md) — model-adaptive budgeting (128K–1M)
  - [The evaluator](concepts/the-evaluator.md) — the deterministic judge and why it's trustworthy
  - [The conductor](concepts/the-conductor.md) — the durable, resumable pipeline (MAP → … → FIX) and the walking skeleton
  - [Skills & memory](concepts/skills-and-memory.md) — the self-improvement loop: drafting, the human skill gate, recall, and auto-promotion
  - [Observability](concepts/observability.md) — events + OTel spans, `loom watch`, Mission Control, OTLP export
  - _(shift mode — added as that subsystem lands)_

## Use it

- [Getting started](guides/getting-started.md) — install, `doctor`, `init`, your first eval
- [The CLI](guides/cli.md) — the `--json` contract, exit codes, command reference
- [Authoring a profile](guides/authoring-a-profile.md)
- [Pod runbook](guides/POD-RUNBOOK.md) — deploying into a locked-down environment

## Extend it

- [Adding a CLI command](guides/extending/adding-a-command.md)
- [Adding an LLM driver](guides/extending/adding-an-llm-driver.md)
- [Adding an evaluator layer](guides/extending/adding-an-eval-layer.md)

## Decisions

- [Architecture Decision Records](decisions/) — the choices we made and why. Read these to understand the _shape_ of the system before changing it.

## Reference

- [Configuration](reference/configuration.md) · [Exit codes](reference/exit-codes.md)
- API reference: run `pnpm docs` to generate it into `docs/api/` from the in-code TSDoc.
