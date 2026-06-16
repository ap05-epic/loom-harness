# Configuration reference

## Files

A profile directory (in the data dir, outside any git tree) contains:

- **`loom.config.yaml`** — the profile (validated on load).
- **`.env`** — secrets and environment-specific values. Real environment variables override `.env` entries.

## `loom.config.yaml`

| Key                | Required | Meaning                                                                                                                              |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `project`          | yes      | Project name.                                                                                                                        |
| `llm.driver`       | yes      | `copilot` (GitHub Copilot login — **default**, no key) · `openai` (direct BYOK key) · `anthropic`.                                   |
| `llm.model`        | yes      | Model id, e.g. `gpt-5.4`. With `copilot` the model is selectable; with a key it's fixed to this value.                               |
| `llm.baseUrlEnv`   | —        | Name of the env var holding the endpoint base URL (must include the version path, e.g. `…/openai/v1`). **Not needed for `copilot`.** |
| `llm.apiKeyEnv`    | —        | Name of the env var holding the API key. **Not needed for `copilot`** (auth is the `copilot login` session).                         |
| `llm.modelProfile` | —        | Overrides: `contextWindow`, `maxOutput`, `vision`.                                                                                   |

**Which provider am I using?** Run `loom models list` (or `doctor`). **`copilot`** = GitHub Copilot login: no key/URL, and you choose the model. **`openai`/`anthropic`** = a direct key (BYOK): locked to the configured `llm.model`. `loom init` defaults to `copilot` when the Copilot CLI is detected and no key is set.

### Pipeline blocks (consumed by `loom map`/`run`/`resume`)

| Key                    | Required for `run` | Meaning                                                                               |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| `source.strutsConfig`  | yes                | Path to `struts-config.xml`, relative to the profile dir or absolute (the MAP input). |
| `app.baseUrl`          | yes                | Base URL of the running legacy app — the "A" baseline the pipeline captures.          |
| `app.storageStatePath` | —                  | Saved auth state (cookies/localStorage) for SSO-gated apps.                           |
| `target.bRepo`         | —                  | Output dir for rebuilds, relative to the data dir or absolute (default: `b-repo`).    |
| `eval.threshold`       | —                  | Max acceptable visual diff %% (default 1; `--threshold` overrides).                   |
| `eval.viewport`        | —                  | `{ width, height }` for capture (default 1280×1024).                                  |

Derived paths under the data dir: `loom.db`, `codeatlas.db`, `baseline/`.

### Crawl block (consumed by `loom crawl`)

| Key               | Meaning                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crawl.startPath` | Path (relative to `app.baseUrl`) to begin crawling from after auth (default `/`).                                                                                                                                  |
| `crawl.exclude`   | URL substrings never to follow — e.g. `['/logout']` (destructive links).                                                                                                                                           |
| `crawl.maxStates` | Cap on distinct screens (`--max-states` overrides).                                                                                                                                                                |
| `crawl.auth`      | Form-login bootstrap: `loginPath`, `usernameSelector`, `passwordSelector`, `submitSelector`, `waitForSelector?`, and **`usernameEnv`/`passwordEnv`** — the env-var names holding the credentials (never the file). |

Remaining sections (`devUrl`, budgets, protected paths, masks) are documented with the subsystems that consume them.

## Environment variables

| Var                                       | Used for                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `LLM_BASE_URL`, `LLM_API_KEY`             | The endpoint + key referenced by `baseUrlEnv`/`apiKeyEnv` (names are configurable). |
| `HARNESS_PROFILE`                         | Default profile directory.                                                          |
| `LOOM_DATA_DIR`                           | Default data directory (state, atlases, artifacts).                                 |
| `HARNESS_SQLITE_BACKEND`                  | Force `better-sqlite3` or `node:sqlite` (default: auto).                            |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Honored for outbound git/npm/Playwright; the LLM host must be in `NO_PROXY`.        |
| `NO_COLOR` / `FORCE_COLOR` / `CI`         | Standard output-mode controls.                                                      |
| `OTEL_EXPORTER_OTLP_ENDPOINT`             | Optional: stream spans to a collector.                                              |

## Global CLI flags

`--profile/-p` · `--data-dir` · `--json` · `--quiet/-q` · `--verbose/-v` · `--no-color` · `--yes/-y` · `--dry-run` · `--no-input`. See the [CLI guide](../guides/cli.md).
