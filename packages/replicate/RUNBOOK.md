# Replicate BAA — Runbook

Convert a legacy BAA (Struts/JSP) screen into a React 1:1 replica that pulls **live data** from the
real backend. Deterministic gates decide parity (pixels + DOM + style + forms + routes + live‑data);
the model only fixes the differences the machine flags. Run everything below **on the pod**.

---

## 0. Setup (once per shell)

```bash
# in the loom-harness repo
git fetch https://github.com/ap05-epic/loom-harness.git replicate-loop && git reset --hard FETCH_HEAD
pnpm install
pnpm --filter @loom/replicate build

# short alias for the CLI
alias rep='node packages/replicate/dist/cli.js'

# credentials — THIS SHELL ONLY, never committed. The FA is the value you type into the FA Number/wire box.
export BAA_USER='…'
export BAA_PASS='…'
export BAA_FA='…'

# the gpt-5.4 connection you already use for `rep run` (Azure/OpenAI endpoint + key)
export LLM_BASE_URL='…'
export LLM_API_KEY='…'
```

---

## 1. Map the app → the atlas  _(skip if `.loom/atlas.db` already exists)_

```bash
rep map --struts <webapp>/WEB-INF/struts-config.xml --out .loom/atlas.db
```

Writes `.loom/atlas.db` and prints every screen + its routes.

## 2. See the whole navigation tree  _(instant — no model, no browser)_

```bash
rep graph --atlas .loom/atlas.db                       # print the tree
rep graph --atlas .loom/atlas.db --json .loom/tree.json   # export JSON
rep graph --atlas .loom/atlas.db --dot  .loom/tree.dot    # export Graphviz DOT
```

This is "what page links to what," already complete from the source — your prep map.

## 2b. Crawl the live app — map EVERY click + where each number comes from  _(the deep map)_

The static tree misses data‑driven drill‑downs. `rep crawl` logs in and clicks **every** link/tab/button
across both FA states, recording all user paths + each screen's data endpoints + which endpoint backs
each rendered value — into `.loom/crawl.db`. Deterministic, resumable, never clicks logout/save/delete.

```bash
# bounded first run to prove it (raise/remove caps once it looks right):
rep crawl --login "http://localhost:8080/BAA/jsp/login.jsp" \
  --user-sel "input[name=user]" --pass-sel "input[name=password]" --submit-sel "input[type=submit]" \
  --max-states 150 --max-depth 15 --load-ms 15000
#   → ✓ crawled N screen(s) · A action(s) · E endpoint(s) · V value(s) → .loom/crawl.db

rep crawl --print            # read the mapped paths + endpoints (no crawling, no login)
```
Tune `--fa-hint "fa.?number|wire|quick"` if the FA phase doesn't unlock; `--follow-js` to also click
overlays (off by default — they can wedge). Re‑running resumes where it stopped.

Then feed the crawl to the converter so the React reproduces navigation 1:1 **and** pulls each number
from the same endpoint — add `--crawl-db .loom/crawl.db` to the `rep run` command in step 4.

## 3. Probe a screen without the model  _(optional, free)_

```bash
# log in + screenshot the post-login landing:
rep shot --login "http://localhost:8080/BAA/jsp/login.jsp" \
  --user-sel "input[name=user]" --pass-sel "input[name=password]" --submit-sel "input[type=submit]"

# map a screen's live links (what each click points to):
rep nav --login "http://localhost:8080/BAA/jsp/login.jsp" \
  --user-sel "input[name=user]" --pass-sel "input[name=password]" --submit-sel "input[type=submit]" \
  --out .loom/nav/dashboard.json
```

## 4. Convert a screen with live data  _(the main command)_

```bash
rep run --screen loginAction --atlas .loom/atlas.db \
  --login "http://localhost:8080/BAA/jsp/login.jsp" \
  --user-sel "input[name=user]" --pass-sel "input[name=password]" --submit-sel "input[type=submit]" \
  --app fixtures/expected-react \
  --webapp /home/devpod/.copilot/BAX-Test-MainRepo/tomcat9/webapps/BAA \
  --reuse-assets \
  --component src/App.tsx --serve dist --route / \
  --build "pnpm exec vite build" \
  --model gpt-5.4 --visual-gate \
  --max-iterations 20 --load-ms 15000
```

### What you'll see

**Before the model runs (a free diagnostic — Ctrl‑C here if it looks wrong):**

- `⏳ waiting for the page to fully load (mainframe)…`
- `🔑 entering the FA at the gateway…` → `✎ FA → <label>` — FA box found ✔
  (if instead `⚠ FA box not found … textboxes: <labels>` → re‑run with `--fa-hint`, see Tuning)
- `🔌 N data endpoint(s): GET /BAA/…Action.do …` — the screen's data sources ✔
- `🔌 live-data proxy: /BAA/* → http://localhost:8080` — live‑data proxy on ✔
- `📝 prep artifact → .loom/screens/loginAction.json`

**Then each iteration:** `✎ writing/fixing…` → `⚙ build…` → `🔍 checking…` → a report line.
`✗ data not live (hardcoded)` means the model rendered without fetching — it gets told to fetch and
retries. Ends with `✓ 1:1 reached` or `✗ stopped after N — differences remain`.

### Results land here

- `.loom/shots/loginAction.png` — the React you built
- `.loom/shots/loginAction.original.png` — the legacy screen (compare side by side)
- `.loom/screens/loginAction.json` — endpoints + runtime links + which states exist

---

## Tuning knobs

| Symptom                          | Fix                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `⚠ FA box not found`             | add `--fa-hint "fa.?number\|wire\|quick"` — a regex matching the real label (it's printed in the warning) |
| pages captured half‑loaded       | raise `--load-ms 25000`                                                                |
| `data not live` never clears     | session may have timed out, or the endpoint returns HTML not JSON — grab the log + `.loom/screens/<key>.json` and we tune the fetch |
| skip the prep file / the shots   | `--no-screens` / `--no-shots`                                                          |
| a different React app dir        | `--app <dir>` (must have an `index.html` + a `vite build`)                             |
| convert a non‑landing screen     | add `--legacy "http://localhost:8080/BAA/<screen>.do"` (it navigates there after login) |

---

## Command reference

```text
rep map    --struts <xml> --out .loom/atlas.db
rep graph  --atlas .loom/atlas.db [--json <f> | --dot <f>]
rep shot   --login <url> [--legacy <screen>] [--user-sel/--pass-sel/--submit-sel <css>]
rep nav    --login <url> [--legacy <screen>] --out <f>
rep crawl  --login <url> [--start <path>] [--db .loom/crawl.db] [--fa-hint <re>] [--follow-js]
           [--max-states N] [--max-actions N] [--max-depth N] [--load-ms 15000] [--print]
rep check  --legacy <url> --replica <url> [--atlas .loom/atlas.db --screen <key>] [--visual-gate]
rep run    --screen <key> --atlas .loom/atlas.db --login <url> --app <dir>
           [--webapp <dir>] [--reuse-assets] [--crawl-db .loom/crawl.db] [--fa-hint <regex>]
           [--load-ms 15000] [--screens .loom/screens | --no-screens] [--visual-gate]
           [--max-iterations N] [--model gpt-5.4] [--shots .loom/shots | --no-shots]
```

Credentials always come from the env (`BAA_USER`, `BAA_PASS`, `BAA_FA`). **The FA is never a flag** and
is redacted in everything written to disk.
