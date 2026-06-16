# Pod runbook — deploying into a locked-down environment

For a restricted Linux environment (no Docker, internal npm mirror, an authenticated proxy, GPT-5.4 reached over an OpenAI-compatible endpoint). Delivery is by `git clone`/`git pull` — never email (gateways strip shell scripts).

## First install

```bash
# 1. clone the release
git clone https://github.com/ap05-epic/modernization-harness && cd modernization-harness
git checkout <latest-tag>

# 2. bootstrap pnpm (absent on the pod) and install
corepack enable                 # or: npm i -g pnpm  (from the internal mirror)
pnpm install --frozen-lockfile  # ~/.npmrc → internal mirror; proxy already set

# 3. build + provide the command
pnpm build
pnpm link --global ./packages/cli
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

## Update loop

Each release ships as a tag. To move forward:

```bash
loom update [--to vX.Y.Z]
```

This fetches tags, checks out the target, reinstalls with the frozen lockfile, rebuilds, backs up `loom.db`, and runs forward-only migrations. **Your state lives in the data directory, so updates never touch it.**

## Safety notes

- Project data (screenshots, HARs, the database) stays in the data dir, outside any repo, and is never committed.
- When crawling a **production** system for the baseline, the surveyor runs read-only (no mutating submissions), rate-limited; production screenshots are treated as sensitive.
