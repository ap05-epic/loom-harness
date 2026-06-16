# @loom/surveyor

The **CRAWL** stage: drive the running legacy app and capture its UI states into a **UI atlas** — the "A" baseline the evaluator compares against, and the inventory the coverage ledger checks ("no screen left behind").

## State identity

The hard part of crawling is deciding when two pages are the _same screen_.

- **`domSignature(dom)`** — a structural fingerprint (tags + structural attributes like `name`/`type`/`role`), with **identical sibling subtrees collapsed** and text ignored. So a table with 3 rows and the same table with 50 rows fingerprint the same.
- **`screenKey({ url, framePath?, dom })`** = `hash(path + frame-path + dom-signature)`. The origin and query string are dropped — local↔production map together (the symmetric fidelity check relies on this), and data variants (`/deal?id=1` vs `/deal?id=2`) collapse to one "deal" screen — while structure and frame path keep genuinely different states apart.

## The crawl

**`crawl({ startUrl, visit, maxStates?, maxVisits? })`** is a breadth-first walk that:

- dedupes by **state key** (many URLs → one screen) and by URL (never re-fetched);
- records each state's same-origin outgoing links (`extractLinks` — resolves relatives, drops cross-origin / `javascript:` / `mailto:` / fragments, dedupes);
- is **hard-bounded** by `maxStates` (distinct screens) and `maxVisits` (total fetches, so a data-variant explosion can't run away), and reports `visited` + `truncated`.

The `visit` seam (URL → captured DOM) keeps the BFS/dedup logic pure and tested without a browser.

## The live crawl

**`crawlApp({ startUrl, auth?, exclude?, maxStates?, … })`** drives a real browser: it opens one **persistent** session (`@loom/browser`'s `CrawlSession`, so the login cookie carries across visits), optionally **form-logs-in** (`auth` fills credentials once), then walks the running app capturing each state's DOM. `exclude` keeps destructive links (e.g. `/logout`) out of the walk — the start of safe crawling; `storageState` reuse and a production `safeMode` build on it.

## Tested

20 tests: the dom signature (row collapse, structure-not-text), screen keys (origin/query normalization, frame-path identity, stable hex), link extraction (resolution, same-origin/scheme filtering, dedupe), the BFS crawl (discovery, data-variant dedup, link recording, `exclude`, `maxStates`/`maxVisits` bounds), and a live, **authenticated** crawl of the fixture (logs in as `analyst`, finds the list + wizard) — self-skipping where no JDK/browser exists.
