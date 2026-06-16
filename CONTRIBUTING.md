# Contributing to the Loom Harness

This project is a foundation meant to be built on for years, so we hold a high bar for clarity, tests, and documentation. This guide is the contract for how we work.

## Principles

1. **Test-driven, always.** No production code without a failing test first. Watch it fail, write the minimal code to pass, refactor. This is non-negotiable for features and bugfixes alike.
2. **Documentation is part of the work, not an afterthought.** A change isn't done until its docs are updated (see [Documentation](#documentation)).
3. **Thin seams, isolated units.** Each package and module has one clear purpose, a well-defined interface, and can be understood and tested on its own. If a file is growing past its job, split it.
4. **Determinism where it matters.** The evaluator (the judge) is LLM-free and pure so it can be trusted and mutation-tested. Pure logic is preferred over side-effectful code; inject clocks, writers, and transports for testability.
5. **Enterprise-safe by default.** Only MIT/Apache-2.0/BSD/ISC/0BSD dependencies (MPL-2.0 is a documented exception). No telemetry, no SaaS, works fully offline after install. Never commit secrets or project data.

## Repository shape

A pnpm monorepo. Each package under `packages/` is an ESM TypeScript project with project references, vitest tests, and a README.

```
packages/
  core         domain types, SQLite (+ node:sqlite fallback), migrations, event log, config
  agents       LlmGateway + drivers, AgentRunner + guards, model profiles, context packer
  evaluator    deterministic visual/behavioural judge (LLM-free)
  cli          the `harness` command (thin presentation layer)
  test-kit     mock LLM server + test helpers
  …            cartographer / surveyor / conductor / mission-control / skills (in progress)
```

## Workflow

```bash
pnpm install
pnpm test            # tsc -b + vitest across all packages
pnpm lint            # eslint
pnpm format          # prettier --check  (pnpm format:fix to write)
pnpm build           # tsc -b
pnpm docs            # typedoc API reference -> docs/api (generated)
```

CI runs lint + format + build + tests on Ubuntu and Windows, plus secret scanning and a production-dependency license gate. All must be green.

## Adding things — the patterns

These three are the most common extension points; each has a guide:

- **A CLI command** → [docs/guides/extending/adding-a-command.md](docs/guides/extending/adding-a-command.md). Define a spec with `defineCommand`, register it, and the `cli-conformance` test will require `--help`, `--json`, a documented exit code, and flag coverage for any prompt.
- **An LLM driver** → [docs/guides/extending/adding-an-llm-driver.md](docs/guides/extending/adding-an-llm-driver.md). Implement `LlmGateway` and prove it against the shared conformance scenario.
- **An evaluator layer** → [docs/guides/extending/adding-an-eval-layer.md](docs/guides/extending/adding-an-eval-layer.md). Add a deterministic check + mutation tests that pass faithful rebuilds and fail sabotaged ones.

## Documentation

Every change keeps docs in sync. Specifically:

- **Public API** gets TSDoc (`/** … */`) on the exported symbol. `pnpm docs` turns this into the API reference.
- **A new package** gets a `README.md`: what it does, what it depends on, and its main entry points.
- **A new concept** (a mechanism a reader must understand) gets a page under `docs/concepts/`.
- **A new task a user performs** gets a guide under `docs/guides/`.
- **A significant decision** (a choice with alternatives and trade-offs) gets a short ADR under `docs/decisions/` — see the existing ones for the format.
- **A release** updates `CHANGELOG.md`.

The test: a new engineer should be able to understand any subsystem, run it, and extend it from the docs alone.

## Commits

Conventional, imperative subject lines scoped by area (`cli:`, `agents:`, `evaluator:`, `docs:`). Keep commits focused and green. We commit (and often tag) at milestone boundaries.
