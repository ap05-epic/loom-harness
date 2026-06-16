# ADR 0006 — Workspace + per-project isolation (Hermes-style)

**Status:** Accepted (2026-06-16)

## Context

The harness was single-project: a profile was just a `project:` string in one `loom.config.yaml`, and all data (`loom.db`, the atlases, `b-repo`, drafted skills) lived under one data dir. Memory and DB-scoped skills were already keyed by project, but nothing stopped two projects from **colliding on the same data dir**, the **tool registry was a flat global map** (so two projects' external/MCP tools could clash by name), and there was **no way to keep several modernization projects side by side**. Before onboarding a large real app — and the others after it — skills, tools, memory, and data must never bleed across projects.

## Decision

Adopt a **workspace** holding **named projects**, each fully isolated, modelled on Hermes:

- A `loom-workspace.yaml` manifest (`{version, active, projects:[{name, dir}]}`) — self-contained (relative project dirs travel with the folder); the CLI is its only writer.
- A single resolver (`resolveProjectContext`) decides which project a command runs against: an explicit `--profile`/`--data-dir` (or their env) **short-circuits to the legacy single-profile path** (so every prior flow + test is untouched), else `--project`/`LOOM_PROJECT` within a discoverable workspace, else the workspace's `active`, else today's cwd-based behavior. It is threaded through the one seam every command resolves a profile at — `context.requireProfile`.
- **Each project gets its own data dir** (`<project>/data`), so `loom.db` / the atlases / `b-repo` can never collide; drafted file-skills default under it too. A manifest that aliases two projects to one data dir is rejected.
- **Tools are namespaced per project** (`<project>__<name>`) where external/MCP tools enter a run; the built-in `write_file` stays un-prefixed (per-attempt, confined by protected-paths).
- `loom project new|list|use|current` manage the workspace; Mission Control gains a project switcher (`GET /api/projects` + `?project=`), read-only — the CLI stays the sole writer of the active pointer.

## Consequences

- **True isolation:** two projects share nothing — data, atlases, `b-repo`, file-skills, tool names — and the already-scoped DB skills + memory are per-project, so the self-improvement loop of one project never contaminates another.
- **Zero migration, zero breakage:** the design is additive and the resolver short-circuits on explicit flags, so a lone `loom.config.yaml` with no workspace behaves exactly as before — the full suite stayed green throughout.
- `--project` is deliberately **not** a global flag (it stays `loom init`'s scaffolding-name flag); per-invocation project selection is `loom project use` + `LOOM_PROJECT`.
- The workspace must live **outside any git tree** — the existing data-dir-not-in-git guard ([ADR 0002]'s sibling concern) still applies per project, since each project's data dir is under the workspace.
