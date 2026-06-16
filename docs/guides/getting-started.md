# Getting started

## Prerequisites

- Node.js ≥ 20.11 (22 and 24 both work)
- pnpm (`corepack enable` if it's not installed)
- git; JDK 17 (for the fixture app and Java scanners)

No Docker is needed.

## Install

```bash
git clone https://github.com/ap05-epic/modernization-harness && cd modernization-harness
corepack enable
pnpm install
pnpm build
pnpm link --global ./packages/cli   # provides the `harness` command
loom --version
```

## Check your environment

```bash
loom doctor
```

This verifies Node, the SQLite backend (and which one loaded), git, pnpm/corepack, and the JDK. Anything red comes with a hint.

## Create a profile

```bash
loom init --data-dir ~/loom-data/demo
```

This writes `loom.config.yaml` and a `.env` **outside** any git clone. Edit the `.env`:

```
LLM_BASE_URL=https://your-endpoint/openai/v1
LLM_API_KEY=…
```

## Talk to the model

```bash
loom models list  --profile ~/loom-data/demo   # the configured model + its resolved profile
loom models test  --profile ~/loom-data/demo   # a tiny live completion (latency + token use)
```

## Scripting

Add `--json` to any command for a clean, machine-readable result on stdout (diagnostics go to stderr):

```bash
loom status --json | jq .data.sqliteBackend
```

## Next

- [The CLI](cli.md) — the full command surface, the `--json` contract, exit codes.
- [Architecture](../architecture.md) — how the whole system fits together.
- Deploying somewhere locked-down? [Pod runbook](POD-RUNBOOK.md).
