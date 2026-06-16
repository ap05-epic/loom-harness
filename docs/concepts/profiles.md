# Profiles

A **profile** is how a project is described to the harness. Everything app- and environment-specific lives here, so the harness core stays generic and reusable ([ADR 0004](../decisions/0004-self-contained.md)).

## Where it lives

A profile is a directory containing `loom.config.yaml` and a `.env`, kept in the **data directory** — always **outside any git clone** (the loader refuses a data dir inside a git tree, so project data and secrets can never be committed). `loom init` scaffolds one.

## Shape (today)

```yaml
project: example
llm:
  driver: openai # the production driver
  model: gpt-5.4
  baseUrlEnv: LLM_BASE_URL # env var holding the endpoint (…/openai/v1)
  apiKeyEnv: LLM_API_KEY # env var holding the key
  modelProfile: # optional overrides for window/output/vision
    contextWindow: 272000
```

The `.env` beside it holds the actual secrets (`LLM_BASE_URL`, `LLM_API_KEY`, …). Real environment variables win over `.env` values.

## Shape (as the pipeline lands)

Later stages read more from the profile; these fields are introduced with their subsystems:

- `legacyBaseUrl` — the **trusted** legacy deployment to baseline against (production; see [ADR 0005](../decisions/0005-production-as-baseline.md)) and optional `devUrl` for the local replica.
- `app.auth` — how to log in (SSO storage-state bootstrap or form login); `app.viewports`.
- `source.root` / `source.modules` — the legacy source checkout to map.
- `target.repo` — where the rebuilt app is written, plus its conventions.
- role→model pins, budgets (token/cost/time), protected paths, masks.

## Resolution

`--profile <dir>` → `HARNESS_PROFILE` → the current directory. `--data-dir`/`LOOM_DATA_DIR` overrides where state is written. See [reference/configuration.md](../reference/configuration.md).
