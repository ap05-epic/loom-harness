# Authoring a profile

A profile points the generic harness at one specific app. See [concepts/profiles.md](../concepts/profiles.md) for the idea and [reference/configuration.md](../reference/configuration.md) for the full field list.

## Start from the wizard

```bash
loom init --data-dir ~/loom-data/<project>
```

Pick a data directory **outside any git clone** — the harness refuses one inside a git tree, because the database, screenshots, and HAR captures it holds may contain real application data and must never be committed.

## Fill in the model

In `loom.config.yaml`:

```yaml
project: <name>
llm:
  driver: openai
  model: gpt-5.4
  baseUrlEnv: LLM_BASE_URL
  apiKeyEnv: LLM_API_KEY
```

In `.env` (beside it):

```
LLM_BASE_URL=https://your-endpoint/openai/v1
LLM_API_KEY=…
```

Validate and probe:

```bash
loom profile validate -p ~/loom-data/<project>
loom models test       -p ~/loom-data/<project>
```

## Grow it with the pipeline

As you map, crawl, and build, you'll add the app's URLs (`legacyBaseUrl` — the **trusted** deployment, often production), auth, viewports, the source checkout, the target repo and its conventions, budgets, protected paths, and visual masks. Each is documented with the stage that uses it. Keep the profile in version control **separately** from this repo if you need to (it lives in your data dir, not here).
