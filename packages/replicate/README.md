# @loom/replicate — map → build → **deterministic check** → fix, in the terminal

Replicate a legacy Struts/JSP screen as a React component that is a **verified 1:1** — same look,
same structure, same form fields, same navigation paths. The novel part: a **machine decides parity**
(pixel + DOM + style + forms + routes), and the model is only ever handed the **concrete differences
to fix**. The LLM never judges whether it matches.

```
map    → every screen + every route (deterministic, no model)
run    → the model writes React → build it → CHECK it → fix the diffs → … until 1:1
check  → the deterministic 1:1 checker, standalone (no model) — usable on any conversion
```

## Why this and not "ask an LLM to convert"

An LLM eyeballing two screenshots and saying "looks good" is unreliable. Here a deterministic checker
produces the exact list of differences; the model only closes them; the loop repeats until the machine
reports a match. That's what makes it converge to a real 1:1, paths included.

## Setup

```bash
git checkout replicate-loop
corepack enable && pnpm install
pnpm --filter @loom/replicate build      # builds the checker + the CLI
# the checker drives a real browser — Playwright Chromium must be installed (cached on the pod)
```

The three commands are `node packages/replicate/dist/cli.js <map|run|check> …`.

## 1. Map the app (deterministic — no model)

```bash
node packages/replicate/dist/cli.js map \
  --struts <webapp>/WEB-INF/struts-config.xml \
  --out    .loom/atlas.db
```

Auto-discovers the sibling `tiles-defs.xml`/`web.xml` and every `*.jsp`, writes a CodeAtlas, and
prints the screen inventory + the route graph — your "here's the whole app" view, and the atlas the
other commands consume.

## 2. Run the loop for a screen (the model writes/fixes the React)

Set the gpt‑5.4 connection in the environment (pod‑side):

```bash
export LLM_BASE_URL="…/openai/v1"     # the Azure/OpenAI endpoint
export LLM_API_KEY="…"                # the gpt‑5.4 key
```

```bash
node packages/replicate/dist/cli.js run \
  --screen  login \
  --atlas   .loom/atlas.db \
  --legacy  "https://<legacy-app>/BAA/login.do" \
  --app     ../my-react-app \          # your React app (the model writes into it)
  --webapp  <webapp> \                 # so it can read the legacy JSP source
  --storage .loom/auth.json \          # saved Playwright auth state for the SSO'd legacy app
  --build   "npx vite build" \         # how to build your app (default: npx vite build)
  --serve   dist --route / \           # what to serve + the screen's route
  --max-iterations 6
```

Each iteration streams to the terminal: the model writes the React → the app builds → the checker
compares the built replica to the live legacy screen → if it isn't 1:1, the **exact diffs** go back to
the model → repeat. Exit 0 = 1:1.

> **The legacy app is behind SSO.** The checker captures the live legacy screen, so it needs a session.
> Provide a Playwright **storage state** via `--storage` (cookies/localStorage saved after a login).
> The pod's existing `loom explore` login flow (AB10 → `#pmenu` hydration → families) can produce the
> screenshots/atlas; the same saved session works here.

## 3. Check any conversion (deterministic — no model)

Point it at the legacy screen and a running replica; it tells you exactly what differs:

```bash
node packages/replicate/dist/cli.js check \
  --legacy  "https://<legacy-app>/BAA/login.do" \
  --replica "http://localhost:5173/login" \
  --atlas   .loom/atlas.db --screen login \   # optional: adds the route/path check
  --storage .loom/auth.json --llm-diff
# → "✓ 1:1 match"  OR  the exact difference list. Exit 0 = match, 1 = differs.
```

Works on **any** React the team produces, not just ours — it's the honest 1:1 oracle.

## What's deterministic vs. model-driven

| Step                                    | Model?        | Proven                                   |
| --------------------------------------- | ------------- | ---------------------------------------- |
| `map` (screens + routes)                | no            | ✓ on the fixture                         |
| `check` (visual+DOM+style+forms+routes) | **no**        | ✓ live + on a real built React app (1:1) |
| the build→check→fix loop control        | no            | ✓ unit                                   |
| `run`'s build/fix step                  | yes (gpt‑5.4) | runs on the pod with the key             |

The whole pipeline is proven locally except the literal gpt‑5.4 call. See `fixtures/expected-react`
(`pnpm exec vite build && node prove.mjs`) for the real‑React 1:1 proof with no model.
