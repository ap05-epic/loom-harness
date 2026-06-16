# @loom/mission-control

The local **Mission Control** dashboard — a read-only window into a Loom run, served over the single `loom.db`.

## What it does

- **`dashboardState(db, runId?)`** — assembles the full read model for one run (default: the latest running, else most recent): the run + stage, screens with their state/diff/attempts, a count-by-state tally, the open **gates** and **questions** inboxes, the span **cost** rollup (tokens + duration), and the recent event feed.
- **`startMissionControl({ db, port? })`** — starts a localhost HTTP server:
  - `GET /` — the self-contained, [`@loom/tokens`](../tokens)-themed single-page dashboard (no build step), which polls `/api/state` every 2s.
  - `GET /api/state[?run=]` · `GET /api/events?since=N` — the read model + event tail as JSON.
  - `POST /api/gates/:id` `{decision}` · `POST /api/questions/:id` `{answer}` — the **only** writes: human gate/question decisions (the one documented exception to the conductor's single-writer rule).
- **`dashboardHtml()`** — the dashboard markup (exported so it can be embedded or snapshot-tested).

## Use it

```
loom ui --data-dir ./.loom-data        # serve; prints the URL, Ctrl-C to stop
loom ui --port 7777 --open             # fixed port, open the browser
```

A run is drivable gate-to-gate from the browser: approve a ship gate or answer a blocked screen's question and the inbox updates on the next poll. See [docs/concepts/observability.md](../../docs/concepts/observability.md).
