# Configuration reference

## Files

A profile directory (in the data dir, outside any git tree) contains:

- **`loom.config.yaml`** — the profile (validated on load).
- **`.env`** — secrets and environment-specific values. Real environment variables override `.env` entries.

## `loom.config.yaml`

| Key                | Required | Meaning                                                                                                                                                                                      |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`          | yes      | Project name.                                                                                                                                                                                |
| `llm.driver`       | yes      | `openai` (direct OpenAI/Azure key — **default + sole live connector**). `anthropic` is gated off (opt in with `LOOM_ENABLE_ANTHROPIC=1`); the `copilot` driver still parses but is disabled. |
| `llm.model`        | yes      | Model id, e.g. `gpt-5.4` — fixed to this value by the key/endpoint.                                                                                                                          |
| `llm.baseUrlEnv`   | yes      | Name of the env var holding the endpoint base URL (must include the version path, e.g. `…/openai/v1`).                                                                                       |
| `llm.apiKeyEnv`    | yes      | Name of the env var holding the API key.                                                                                                                                                     |
| `llm.modelProfile` | —        | Overrides: `contextWindow`, `maxOutput`, `vision`.                                                                                                                                           |

**Which provider am I using?** Run `loom models list` (or `doctor`). The Azure/OpenAI link + key is Loom's sole live connector: set `llm.driver: openai` with `LLM_BASE_URL` (…/openai/v1) + `LLM_API_KEY`; `loom init` writes that by default. (`anthropic` ships for portability but is gated off unless `LOOM_ENABLE_ANTHROPIC=1`; the `copilot` driver code still ships but is disabled.)

### Pipeline blocks (consumed by `loom map`/`run`/`resume`)

| Key                    | Required for `run` | Meaning                                                                                                                                                                                                     |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source.strutsConfig`  | yes                | Path to `struts-config.xml`, relative to the profile dir or absolute (the MAP input).                                                                                                                       |
| `app.baseUrl`          | yes                | Base URL of the running legacy app — the "A" baseline the pipeline captures.                                                                                                                                |
| `app.storageStatePath` | —                  | Saved Playwright auth state (cookies + localStorage) for SSO-gated apps.                                                                                                                                    |
| `app.cookiesPath`      | —                  | Path to a JSON array of Playwright cookies (an SSO session exported from a browser), read **fresh each run** — refresh the file when the session expires; no rebuild. Layered on top of `storageStatePath`. |
| `target.bRepo`         | —                  | Output dir for rebuilds, relative to the data dir or absolute (default: `b-repo`).                                                                                                                          |
| `eval.threshold`       | —                  | Max acceptable visual diff %% (default 1; `--threshold` overrides).                                                                                                                                         |
| `eval.viewport`        | —                  | `{ width, height }` for capture (default 1280×1024).                                                                                                                                                        |

Derived paths under the data dir: `loom.db`, `codeatlas.db`, `baseline/`.

### Crawl block (consumed by `loom crawl`)

| Key               | Meaning                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crawl.startPath` | Path (relative to `app.baseUrl`) to begin crawling from after auth (default `/`).                                                                                                                                                                                                                                                                      |
| `crawl.exclude`   | URL substrings never to follow — e.g. `['/logout']` (destructive links).                                                                                                                                                                                                                                                                               |
| `crawl.maxStates` | Cap on distinct screens (`--max-states` overrides).                                                                                                                                                                                                                                                                                                    |
| `crawl.faEnv`     | Env-var name holding the FA Quick-Search code the AI-explorer (`loom explore`) types as `$fa` (default `fa_numbers`); the value lives only in `.env`.                                                                                                                                                                                                  |
| `crawl.hydrateMs` | ms to wait for late-AJAX controls (e.g. BAA's `#pmenu`) to appear before reading a page — raise it for apps whose menus load after the document.                                                                                                                                                                                                       |
| `crawl.auth`      | Form-login bootstrap: `loginPath`, `usernameSelector`, `passwordSelector`, `submitSelector`, `waitForSelector?`, and **`usernameEnv`/`passwordEnv`** — the env-var names holding the credentials (never the file). `loom explore` reuses `usernameEnv`/`passwordEnv` as `$user`/`$pass` and ignores the selectors (the model finds the fields itself). |

Remaining sections (`devUrl`, budgets, protected paths, masks) are documented with the subsystems that consume them.

## Environment variables

| Var                                       | Used for                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `LLM_BASE_URL`, `LLM_API_KEY`             | The endpoint + key referenced by `baseUrlEnv`/`apiKeyEnv` (names are configurable). |
| `LOOM_ENABLE_ANTHROPIC`                   | Set to `1` to un-gate the dormant Anthropic driver (off by default; portability).   |
| `HARNESS_PROFILE`                         | Default profile directory.                                                          |
| `LOOM_DATA_DIR`                           | Default data directory (state, atlases, artifacts).                                 |
| `HARNESS_SQLITE_BACKEND`                  | Force `better-sqlite3` or `node:sqlite` (default: auto).                            |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Honored for outbound git/npm/Playwright; the LLM host must be in `NO_PROXY`.        |
| `NO_COLOR` / `FORCE_COLOR` / `CI`         | Standard output-mode controls.                                                      |
| `OTEL_EXPORTER_OTLP_ENDPOINT`             | Optional: stream spans to a collector.                                              |

## Global CLI flags

`--profile/-p` · `--data-dir` · `--json` · `--quiet/-q` · `--verbose/-v` · `--no-color` · `--yes/-y` · `--dry-run` · `--no-input`. See the [CLI guide](../guides/cli.md).
