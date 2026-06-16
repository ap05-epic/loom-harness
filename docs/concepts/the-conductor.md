# The conductor (the pipeline)

The conductor is the harness's **outer loop**. Where the Builder agent is one inner loop (model ⇄ tools for a single attempt), the conductor is the durable, resumable process that takes a screen — or a whole app — from undocumented legacy source to a parity-passing rebuild, and records every step.

## The pipeline

```
MAP ─▶ CRAWL ─▶ PLAN ─▶ ( BUILD ─▶ EVAL ─▶ FIX )*  ─▶ done
```

| Stage     | What happens                                                                                                                                                                  | Subsystem                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **MAP**   | Build the enriched CodeAtlas (Struts + Tiles + web.xml + JSPs) and the repo-map.                                                                                              | `cartographer`            |
| **CRAWL** | Capture the legacy "A" baseline screenshot for each target screen.                                                                                                            | `browser`                 |
| **PLAN**  | Create one work package per screen in the task graph.                                                                                                                         | `core` (TaskStore)        |
| **BUILD** | A Builder attempt rebuilds the screen from a work order carrying the recovered docs, forms, real JSP source, and repo-map; emits files through a protected `write_file` tool. | `agents` + `conductor`    |
| **EVAL**  | Serve the rebuilt b-repo, capture "B"; run the visual diff and the structural DOM diff vs "A"; pass only if both clear.                                                       | `conductor` + `evaluator` |
| **FIX**   | On a miss, retry with prior-attempt feedback up to `maxAttempts`; otherwise mark the screen blocked.                                                                          | `conductor`               |

A screen reaches `passed` when its visual diff is within threshold, or `blocked` when attempts run out (a human picks it up via the inbox, later).

## Durable by construction

The conductor is the **single writer** of `loom.db`. Each stage advances the run's stage and writes work-package/attempt/eval rows plus a correlation-chained event (`run → wp → attempt → step`). Nothing the harness does is unexplainable after the fact — the read-only board (`loom wp list/show`, `loom logs`) and Mission Control (later) are just views over these writes.

## Crash-resume

Because state lives in the database, a killed run resumes cleanly:

1. On entry, any attempt still marked `running` belongs to a dead process → reconciled to `interrupted`.
2. MAP and PLAN are idempotent (the atlas is reused; work packages are matched by screen key).
3. Only work packages that aren't already `passed`/`shipped` (and aren't awaiting a human) are re-processed.

`loom resume` runs this against the latest interrupted run; `loom run --run <id>` targets a specific one.

## Protected paths

The Builder can write **only** inside its b-repo output directory. The `write_file` tool refuses any path that resolves outside that root — the tool-layer half of the protected-paths safeguard. The legacy source, the atlases, and the harness itself are never writable by an agent.

## Testability — the injected seam

The orchestration is pure enough to test without a browser: `runPipeline` takes an injectable `capture` seam. Tests drive the entire state machine — pass, blocked, event chain, crash-resume — with a scripted mock LLM and fake captures, deterministically and fast. A separate end-to-end test (self-skipping where no JDK/browser exists) exercises the real browser path against the bundled legacy fixture, proving the login screen goes MAP → build → eval → **passed**. This is the "walking skeleton": the thinnest vertical slice through every subsystem, end to end.

## Related

- [The evaluator](the-evaluator.md) — the LLM-free judge the EVAL stage calls.
- [Profiles](profiles.md) — where a project's source, app URL, and target live.
- [LLM gateway & drivers](llm-gateway-and-drivers.md) — how the Builder reaches a model.
