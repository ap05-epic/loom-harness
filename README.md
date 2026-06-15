# Modernization Harness

A reusable, open-source agentic system that **maps undocumented legacy codebases, crawls their running UIs, and rebuilds them in modern stacks** with pixel- and function-faithful parity — verified by an automated A/B evaluation. The first target is a Struts 1.x / JSP UI → React; the harness itself is project-agnostic (everything app-specific lives in a swappable _profile_).

> **Status: v0.1.0 — foundations (M0).** Core, the LLM gateway (OpenAI-compatible + Anthropic drivers), the model-adaptive context packer, and the full CLI are in place and tested. The mapping/crawling/building/evaluation pipeline lands in later milestones (see the roadmap below).

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
pnpm link --global ./packages/cli      # provides the `harness` command

harness doctor                          # verify the environment
harness init --data-dir ~/harness-data/demo   # create a profile (outside any repo)
# edit ~/harness-data/demo/.env  → LLM_BASE_URL (…/openai/v1) + LLM_API_KEY
harness models test --profile ~/harness-data/demo   # probe the LLM endpoint
```

Deploying inside a locked-down environment? See [`docs/POD-RUNBOOK.md`](docs/POD-RUNBOOK.md).

## CLI

`harness` is scriptable-first: **every command supports `--json`** (one result envelope on stdout, diagnostics on stderr) and returns a **documented exit code**. Interactive wizards degrade cleanly to flags, so nothing ever hangs in CI or over SSH.

| Group | Commands |
|---|---|
| Lifecycle | `init` · `doctor` · `update` · `status` · `profile show\|validate` · `models list\|test` · `db migrate\|backup` |
| Pipeline _(landing in M1–M6)_ | `map` · `crawl` · `plan` · `build` · `eval` · `run [--shift]` · `resume` · `stop` |
| Observe _(M7)_ | `watch` · `logs` · `report` · `ui` |
| Work & gates _(M6)_ | `wp` · `gates` · `questions` |
| Knowledge _(M3/M6)_ | `skills` · `memory` · `atlas` |

Run `harness <command> --help` for flags and examples; the help footer lists every exit code.

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
