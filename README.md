<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/loom-mark-dark.svg" />
    <img src="docs/loom-mark.svg" width="92" height="92" alt="Loom Harness — three keys in the harness, crossed by a single weft thread" />
  </picture>
</p>

<h1 align="center">Loom Harness</h1>

<p align="center"><strong>legacy UI, rebuilt faithfully</strong></p>

<p align="center">
  <img src="docs/loom-cli.svg" width="660" alt="The loom startup identity — the brass LOOM wordmark over the active model, project, and SQLite backend" />
</p>

<p align="center">
  Loom Harness maps undocumented legacy apps, rebuilds their screens in modern code,<br/>
  and proves each rebuild is <em>identical</em> to the original.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-46B17A" alt="MIT licensed" />
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020.11-5B8DEF" alt="Node >= 20.11" />
  <img src="https://img.shields.io/badge/built%20with-TypeScript-9A7CF0" alt="TypeScript" />
  <img src="https://img.shields.io/badge/tests-TDD-E2A74A" alt="TDD throughout" />
</p>

A reusable, open-source agentic system that **maps undocumented legacy codebases, crawls their running UIs, and rebuilds them in modern stacks** with pixel- and function-faithful parity — verified by an automated, deterministic A/B evaluation. The first target is a Struts 1.x / JSP / Tiles application → React 19 + TypeScript; the harness itself is project-agnostic (everything app-specific lives in a swappable _profile_).

> **Why "Loom"?** We rebuild screen-by-screen the way a loom weaves new cloth from old threads — and in a loom, the **harness** is the part that lifts the threads to form the pattern. The mark is **three keys** (the legacy systems it unlocks) held in a frame and crossed by a single **weft** thread (the modern rebuild woven through). Access, weaving, and a pixel grid — in one glyph.

## What it does

A durable, resumable pipeline takes one screen from legacy source to a proven rebuild:

```
MAP ─▶ CRAWL ─▶ PLAN ─▶ ( BUILD ─▶ EVAL ─▶ FIX )* ─▶ REFLECT ─▶ ship
```

- **MAP** — custom Struts / Tiles / JSP / web.xml scanners build a CodeAtlas (graph + FTS + PageRank repo-map), then an LLM pass writes the documentation the app never had.
- **CRAWL** — a Playwright surveyor walks the running app (the trusted/production baseline), capturing screenshots, DOM, computed styles, forms, and nav edges; an **AI-explorer** reaches the screens behind menus/tabs/buttons that link-following can't (e.g. a `qpmenu` shell), persisting everything into a UI atlas.
- **PLAN** — a planner emits dependency-ordered work packages (shared layout/components first); a human approves the plan gate.
- **BUILD → EVAL → FIX** — the agent loop writes the rebuild inside a protected `b-repo`, then a **deterministic, LLM-free evaluator** judges it across **seven layers** (visual · structural DOM · computed-style · functional/validation · accessibility · anti-cheat, plus the coverage ledger) so the builder can never argue with the judge.
- **REFLECT → ship** — passed screens distill into reusable SKILL.md skills (screen #50 is faster than screen #5); a human approves the ship gate; integration evals re-run cumulatively so a shared-component change can't silently regress a passed screen.

Runs unattended in **shift mode** with hard safeguards (per-attempt + per-shift budgets, stop-the-line on regression, protected paths, a kill switch), and stays fully observable through **Mission Control** (live workers, pipeline, cost, eval analytics, the gate/question inbox) and OpenTelemetry spans.

## Requirements

- **Node.js ≥ 20.11** (works on 22 and 24)
- **pnpm** (bootstrap with `corepack enable` if absent)
- **git**; **JDK 17** for the fixture app and Java scanners
- No Docker required. SQLite runs natively (`better-sqlite3`) or via Node's built-in `node:sqlite` fallback — whichever loads.

## Quickstart

```bash
git clone https://github.com/ap05-epic/loom-harness && cd loom-harness
corepack enable && pnpm install && pnpm build
pnpm link --global ./packages/cli         # provides the `loom` command

loom doctor                               # verify the environment
loom init --data-dir ~/loom-data/demo     # create a profile (outside any repo)
# edit ~/loom-data/demo/.env  → a Copilot login, or LLM_BASE_URL (…/openai/v1) + LLM_API_KEY
loom models test --profile ~/loom-data/demo   # probe the model backend
```

Models are reached via a **GitHub Copilot login by default** (no key or URL) or a direct OpenAI/Azure key — your choice, surfaced by `loom models list`. Deploying inside a locked-down environment? See the [Pod runbook](docs/guides/POD-RUNBOOK.md) and the [onboarding playbook](docs/guides/baa-onboarding.md).

## CLI

`loom` is scriptable-first: **every command supports `--json`** (one result envelope on stdout, diagnostics on stderr) and returns a **documented exit code**. Interactive wizards degrade cleanly to flags, so nothing ever hangs in CI or over SSH. Bare `loom` prints a compact dashboard; the one-line mark `│┼│ loom` rides the status line.

| Group        | Commands                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Lifecycle    | `init` · `doctor` · `update` · `status` · `profile show\|validate` · `models list\|test` · `db migrate\|backup` |
| Pipeline     | `map` · `crawl` · `plan` · `build` · `eval` · `run [--shift]` · `resume` · `stop`                               |
| Observe      | `watch` · `logs` · `report` · `ui`                                                                              |
| Work & gates | `wp` · `gates` · `questions`                                                                                    |
| Knowledge    | `skills` · `memory` · `atlas`                                                                                   |
| Project      | `project new\|list\|use\|current`                                                                               |

Run `loom <command> --help` for flags and examples; the help footer lists every exit code.

Multiple modernization projects coexist in a **workspace** (`loom-workspace.yaml`) with fully isolated data, atlases, skills, memory, and tools — `loom project use <name>` switches the active one ([ADR 0006](docs/decisions/0006-workspace-project-isolation.md)).

## Packages

A pnpm monorepo of strict-TypeScript, ESM packages under `@loom/*`:

| Package           | Responsibility                                                              |
| ----------------- | --------------------------------------------------------------------------- |
| `core`            | domain types · SQLite + migrations · append-only event log + spans · config |
| `agents`          | LLM gateway (Copilot / OpenAI / Anthropic) · guards · model-adaptive packer |
| `cartographer`    | legacy scanners → CodeAtlas · repo-map · documentation pass                 |
| `surveyor`        | Playwright crawler → UI atlas (screenshots, DOM, styles, forms, nav)        |
| `evaluator`       | the deterministic, LLM-free parity judge + coverage ledger                  |
| `conductor`       | the durable pipeline · shift mode · gates · integration evals               |
| `mission-control` | the local observability dashboard + human-in-the-loop decisions             |
| `skills`          | SKILL.md runtime · progressive disclosure · DIGIT export                    |
| `tokens`          | the `@loom/tokens` design palette                                           |
| `cli`             | the `loom` operator surface                                                 |
| `test-kit`        | mock LLM server + fixtures                                                  |

## Brand palette

| Token                         | Hex       | Use                                      |
| ----------------------------- | --------- | ---------------------------------------- |
| **Thread** (signature accent) | `#E2A74A` | logo weft, focus, active, gate/attention |
| **Ink** (dark canvas)         | `#14161F` | app background (dark, default)           |
| **Paper** (light canvas)      | `#F6F3EC` | app background (light)                   |
| Parity / pass                 | `#46B17A` | a screen passed the judge                |
| Fail                          | `#E0533D` | eval failed / error                      |
| Running / info                | `#5B8DEF` | in progress                              |
| Agent activity                | `#9A7CF0` | LLM / agent spans                        |

Voice: precise, calm, evidence-first — **verbs over adjectives**. "12 screens shipped, 3 pending a gate," not "amazing progress." The product earns trust by being quietly exact.

## Documentation

Full docs live in [`docs/`](docs/README.md): the [architecture](docs/architecture.md), [concepts](docs/concepts/), [guides](docs/guides/), [decision records](docs/decisions/), and a generated [API reference](docs/reference/) (`pnpm docs`). Contributing? Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
pnpm test        # build + vitest across all packages (TDD throughout)
pnpm lint        # eslint
pnpm format      # prettier check
```

## Status

Pre-1.0, in active development. The foundations, the full MAP→CRAWL→PLAN→BUILD→EVAL→FIX pipeline, the deterministic evaluator, skills/memory recall, shift-mode safeguards, the typed-tool + hook substrate, MCP, parallel workers, and Mission Control are all in place and tested. The live frontier is onboarding the first real application end-to-end on the pod.

## License

[MIT](LICENSE)
