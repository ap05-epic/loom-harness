# @loom/conductor

The **outer loop**: the durable orchestrator that drives one screen (or a whole app) from the legacy source to a parity-passing rebuild, persisting every step so a killed run can be resumed.

It ties the subsystems together — `cartographer` (MAP), `browser` (capture), `agents` (the Builder), `evaluator` (the judge) — over the `core` task graph (runs / work packages / attempts / eval scores) and event log.

## The pipeline

`runPipeline()` walks one run through:

```
MAP → CRAWL → PLAN → ( BUILD → EVAL → FIX )* → done
```

- **MAP** — build the **enriched** CodeAtlas (Struts + Tiles + web.xml + JSPs, auto-discovered) and the repo-map; idempotent and reused on resume.
- **CRAWL** — capture the legacy "A" baseline screenshot per target screen.
- **PLAN** — one work package per screen (idempotent; reused on resume).
- **BUILD** — a pluggable `BuildStrategy`. The default (`buildScreen`) runs our agent loop with a single `write_file` tool confined to the b-repo; for a **GitHub Copilot login with no key**, `copilotBuildStrategy` delegates to Copilot's own agent (`copilot --allow-all-tools -C <b-repo>`), which writes the files itself — the deterministic evaluator still gates the result. Either way the **work order** (`buildWorkOrder`) carries the cartographer's full context: the recovered documentation, the parsed forms (fields + options), the **real legacy JSP source**, and the whole-app repo-map.
- **EVAL** — serve the b-repo, capture "B", diff A vs B, record the score.
- **FIX** — on a miss, retry with prior-attempt feedback up to `maxAttempts`, else mark the screen `blocked`.

Every transition is written to the `TaskStore` and a correlation-chained event (`run → wp → attempt`) to the `EventLog`, so the read-only board (`loom wp list/show`, `loom logs`) and, later, Mission Control reflect exactly what happened.

## Parallel workers

`maxParallel` (default `1` = serial) runs that many **independent** screens through `BUILD → EVAL → FIX` at once via a bounded worker pool (`loom run --max-parallel N`). Shift guards are checked before each dispatch: once a budget / wall-clock / stop-the-line limit trips, in-flight screens finish but no new one starts, so a parallel run still stops gracefully. The `mapPool` (bounded concurrency) and `runWithDeps` (dependency-first — shared components before the screens that depend on them) primitives back this, and `classifyActivity` turns a worker's idle time into the heartbeat's `active` / `long_running` / `stalled` / `stuck` "is it wedged?" signal.

## Shift-mode safeguards

For unattended runs, `runPipeline` takes run-level `shift` limits that bound the **whole run** (the four `AgentRunner` guards only bound a single build): a cumulative **token budget**, a **wall-clock** cap, and **stop-the-line** (halt after N consecutive screen failures). Any trip stops the run **gracefully** — status `stopped`, a `shift.stopped` event, and `stopReason` in the result — leaving the rest of the scope untouched instead of thrashing. `loom run --shift` enables it.

## Crash-resume

Call `runPipeline({ …, runId })` again after a crash: it reconciles interrupted attempts (a `running` attempt on a fresh process is dead) and finishes only the unfinished work packages. `loom resume` does this from the latest interrupted run.

## Protected paths

The Builder's `write_file` tool (`createWriteFileTool`) refuses any path that resolves outside its output root — the tool-layer half of protected paths. Agents can write only inside the b-repo, never the legacy source, the atlases, or the harness itself.

## What it provides

- **`runPipeline(options)`** — the orchestration entry point. The screenshot seam (`capture`) is injectable, so the whole state machine is tested deterministically with a mock LLM and no browser; the real browser path is covered by a self-skipping end-to-end test.
- **`buildScreen(options)`** — one Builder attempt over `AgentRunner`'s guards; returns status, files written, usage.
- **`createWriteFileTool(rootDir)`** — the protected-path `write_file` tool.
- **`serveDir(dir)`** — a traversal-safe static server for capturing the rebuilt b-repo.

## Tested

`serve` (content-types, traversal refusal); `write_file` enforcement; `buildScreen` loop + guard trip; `runPipeline` pass / blocked / event-chain / **crash-resume** with injected seams; plus a real browser + JDK end-to-end proving the fixture login goes MAP → build → eval → **passed** at < 2 % visual diff (self-skips where either is absent).
