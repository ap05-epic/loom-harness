# Loom Harness

A reusable, open-source agentic system that **maps undocumented legacy codebases, crawls their running UIs, and rebuilds them in modern stacks** with pixel- and function-faithful parity — verified by an automated A/B evaluation. The first target is a Struts 1.x / JSP UI → React; the harness itself is project-agnostic (everything app-specific lives in a swappable _profile_).

> **Status: pre-1.0, in active development.** The durable pipeline (MAP → CRAWL → PLAN → BUILD → EVAL → FIX), the deterministic evaluator, skills/memory recall, shift-mode safeguards, and the registry-driven CLI are in place and tested. Models are reached via a **GitHub Copilot login by default** (no key/URL needed) or a direct OpenAI/Azure key — your choice, surfaced by `loom models list`. The harness-core evolution (typed tools + hooks, MCP, parallel workers, Mission Control) is underway — see the roadmap.

## Requirements

- **Node.js ≥ 20.11** (works on 22 and 24)
- **pnpm** (bootstrap with `corepack enable` if absent)
- **git**; **JDK 17** for the fixture app and Java scanners
- No Docker required. SQLite runs natively (`better-sqlite3`) or via Node's built-in `node:sqlite` fallback — whichever loads.

## Quickstart

```bash
git clone https://github.com/ap05-epic/modernization-harness && cd modernization-harness
corepack enable
pnpm install
pnpm build
pnpm link --global ./packages/cli      # provides the `loom` command

loom doctor                          # verify the environment
loom init --data-dir ~/loom-data/demo   # create a profile (outside any repo)
# edit ~/loom-data/demo/.env  → LLM_BASE_URL (…/openai/v1) + LLM_API_KEY
loom models test --profile ~/loom-data/demo   # probe the LLM endpoint
```

Deploying inside a locked-down environment? See the [Pod runbook](docs/guides/POD-RUNBOOK.md).

## Documentation

Full docs live in [`docs/`](docs/README.md): the [architecture](docs/architecture.md), [concepts](docs/concepts/), [guides](docs/guides/), [decision records](docs/decisions/), and a generated [API reference](docs/reference/) (`pnpm docs`). Contributing? Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## CLI

`harness` is scriptable-first: **every command supports `--json`** (one result envelope on stdout, diagnostics on stderr) and returns a **documented exit code**. Interactive wizards degrade cleanly to flags, so nothing ever hangs in CI or over SSH.

| Group                         | Commands                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Lifecycle                     | `init` · `doctor` · `update` · `status` · `profile show\|validate` · `models list\|test` · `db migrate\|backup` |
| Pipeline _(landing in M1–M6)_ | `map` · `crawl` · `plan` · `build` · `eval` · `run [--shift]` · `resume` · `stop`                               |
| Observe _(M7)_                | `watch` · `logs` · `report` · `ui`                                                                              |
| Work & gates _(M6)_           | `wp` · `gates` · `questions`                                                                                    |
| Knowledge _(M3/M6)_           | `skills` · `memory` · `atlas`                                                                                   |

Run `loom <command> --help` for flags and examples; the help footer lists every exit code.

## Development

```bash
pnpm test        # build + vitest across all packages (TDD throughout)
pnpm lint        # eslint
pnpm format      # prettier check
```

Packages: `core` (SQLite + migrations + event log + config), `agents` (LLM gateway, guards, context packer), `cartographer` / `surveyor` / `evaluator` / `conductor` / `mission-control` (pipeline — in progress), `cli`, `skills`, `test-kit`, plus a `fixtures/` legacy test app.

## Roadmap

`M0` foundations ✅ · `M1` fixture + evaluator MVP · `M2` walking skeleton (one screen, map→React) · `M3–M5` deepen cartographer/surveyor/evaluator · `M6` autonomous shift mode + skills/memory + safeguards · `M7` Mission Control + observability · `M8` offline packaging → `v1.0.0`.

## License

MIT
