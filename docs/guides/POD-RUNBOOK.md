# Pod runbook — deploying into a locked-down environment

For a restricted Linux environment (no Docker, internal npm mirror, an authenticated proxy, GPT-5.4 reached over an OpenAI-compatible endpoint). Delivery is by `git clone`/`git pull` — never email (gateways strip shell scripts).

## First install

The one-shot script does everything below and verifies it (idempotent — safe to re-run):

```bash
git clone https://github.com/ap05-epic/loom-harness && cd loom-harness
git checkout <latest-tag>
bash scripts/setup-pod.sh --data-dir ~/loom-data/<project>
#   add --base-url https://<host>/openai/v1 --api-key <key>  to skip the prompts
```

Or step by step:

```bash
# 1. clone the release
git clone https://github.com/ap05-epic/loom-harness && cd loom-harness
git checkout <latest-tag>

# 2. bootstrap pnpm (absent on the pod) and install
corepack enable                 # or: npm i -g pnpm  (from the internal mirror)
pnpm install --frozen-lockfile  # ~/.npmrc → internal mirror; proxy already set

# 3. build + provide the command
pnpm build
pnpm link --global ./packages/cli   # if this fails (no global bin dir), call: node packages/cli/dist/bin.js …
loom --version
```

If `better-sqlite3`'s native prebuild won't install, do nothing — the adapter falls back to `node:sqlite`. `loom doctor` shows which backend is live.

## Configure

```bash
loom init --data-dir ~/loom-data/<project>   # writes config + .env OUTSIDE the clone
```

Fill `~/loom-data/<project>/.env` for the **direct** endpoint (Model B):

```
LLM_BASE_URL=https://<host>/openai/v1     # note the /openai/v1 path
LLM_API_KEY=…
```

The LLM host must be covered by `NO_PROXY` so model calls bypass the proxy; git/npm/Playwright go through it.

## Verify

```bash
loom doctor    # node, sqlite backend, browser launch, LLM ping, proxy bypass, JDK, data-dir safety
loom models test
```

Paste the `doctor` output back if anything is red.

## Doctor's green — now what?

```bash
loom next                                                     # the next command for your state
loom chat   --data-dir ~/loom-data/<project>                  # drive it by talking — "what's the status?", "rebuild login" (asks before anything expensive)
loom map    --data-dir ~/loom-data/<project>                  # scan the legacy source → CodeAtlas
loom crawl  --data-dir ~/loom-data/<project> --max-states 20  # capture the baseline (read-only)
loom run    --data-dir ~/loom-data/<project> --shift          # rebuild unattended (loom stop / loom resume)
loom ui     --data-dir ~/loom-data/<project>                  # Mission Control: progress + gate approvals
```

Sanity-check the model any time with `loom ask "say pong"` or `loom models test`. See [how you interact with Loom](../concepts/interaction-model.md) for the full picture. For BAA specifically, load the conversion skills first — `loom skills load --from skills/conversion --data-dir ~/loom-data/<project>` — and follow the [onboarding playbook](baa-onboarding.md).

## Update loop

Each release ships as a tag. To move forward:

```bash
loom update [--to vX.Y.Z]
```

This fetches tags, checks out the target, reinstalls with the frozen lockfile, rebuilds, backs up `loom.db`, and runs forward-only migrations. **Your state lives in the data directory, so updates never touch it.**

## Offline rehearsal

Before trusting an autonomous shift, dry-run the whole loop on the pod with no public-internet egress (only the mirror + the LLM endpoint):

```bash
bash scripts/offline-rehearsal.sh                 # install → build → tests → doctor → fixture pipeline
FROM_TAG=v1.0.0 TO_TAG=v1.1.0 bash scripts/offline-rehearsal.sh   # also rehearse the update loop
```

It fails loudly on the first broken step, and writes its scratch data to a temp dir outside the clone.

## Troubleshooting

- **`pnpm link --global` fails (`ERR_PNPM_NO_GLOBAL_BIN_DIR`).** The pod has no global bin dir. `setup-pod.sh` writes a `~/.local/bin/loom` wrapper; or just invoke `node packages/cli/dist/bin.js …`.
- **`loom models test` fails.** Re-check `LLM_BASE_URL` (it must end in `…/openai/v1`) + `LLM_API_KEY`, and that `NO_PROXY` covers the LLM host so model calls bypass the proxy. The error is classified: **401** → check the key; **404** → check the model id and the `…/openai/v1` path; transient **429/5xx** are retried once.
- **Azure endpoint 401 / 404.** 401 → check `LLM_API_KEY`; 404 → the model id or base URL is wrong (it must include `…/openai/v1`). `loom models test` prints the classified reason. Transient 429/5xx are retried once automatically.
- **better-sqlite3 native build fails** (missing `make`/compiler, GLIBC). Expected and harmless — the adapter falls back to `node:sqlite`; `loom doctor` shows the live backend.

## Safety notes

- Project data (screenshots, HARs, the database) stays in the data dir, outside any repo, and is never committed.
- When crawling a **production** system for the baseline, the surveyor runs read-only (no mutating submissions), rate-limited; production screenshots are treated as sensitive.
