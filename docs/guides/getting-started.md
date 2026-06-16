# Getting started

## Prerequisites

- Node.js ≥ 20.11 (22 and 24 both work)
- pnpm (`corepack enable` if it's not installed)
- git; JDK 17 (for the fixture app and Java scanners)

No Docker is needed.

## Install

```bash
git clone https://github.com/ap05-epic/loom-harness && cd loom-harness

# One-shot (recommended): install, build, put `loom` on PATH, create + verify a profile.
bash scripts/setup-pod.sh

# …or by hand:
corepack enable && pnpm install && pnpm build
pnpm link --global ./packages/cli   # or just call: node packages/cli/dist/bin.js
loom --version
```

> On a locked-down pod, `pnpm link --global` can fail with `ERR_PNPM_NO_GLOBAL_BIN_DIR`. `setup-pod.sh` handles this by writing a `~/.local/bin/loom` wrapper; by hand you can always run `node packages/cli/dist/bin.js …`.

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
loom ask          --profile ~/loom-data/demo "say pong"   # a one-off question
loom chat         --profile ~/loom-data/demo              # an interactive REPL (/exit to quit)
```

`ask`/`chat` are a direct line to the model — handy for a sanity check or a quick question. They don't run the pipeline; that's `map` → `crawl` → `run` (see below). How you drive the harness day-to-day is covered in [the interaction model](../concepts/interaction-model.md).

## Scripting

Add `--json` to any command for a clean, machine-readable result on stdout (diagnostics go to stderr):

```bash
loom status --json | jq .data.sqliteBackend
```

## Doctor's green — now what?

`loom next` always names the next step from your project's state. The happy path:

```bash
loom next   --data-dir ~/loom-data/demo   # prints the next command for where you are
loom map    --data-dir ~/loom-data/demo   # 1. scan the legacy source → CodeAtlas (+ generated docs)
loom crawl  --data-dir ~/loom-data/demo   # 2. capture the running app (the trusted baseline)
loom run    --data-dir ~/loom-data/demo   # 3. rebuild → evaluate → fix  (add --shift to run unattended)
loom ui     --data-dir ~/loom-data/demo   # watch progress + approve gates in Mission Control
```

`run` reads the legacy source path, app URL, and rebuild target from the [profile](authoring-a-profile.md). A `--shift` run can be halted with `loom stop` and picked up again with `loom resume`.

## Next

- [The CLI](cli.md) — the full command surface, the `--json` contract, exit codes.
- [Architecture](../architecture.md) — how the whole system fits together.
- Deploying somewhere locked-down? [Pod runbook](POD-RUNBOOK.md).
