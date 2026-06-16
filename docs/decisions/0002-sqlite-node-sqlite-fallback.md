# ADR 0002 — SQLite as the store, with a `node:sqlite` fallback

**Status:** Accepted (2026-06-15)

## Context

The harness needs a durable system of record (task graph, event log, atlases) that survives crashes and supports an autonomous multi-hour run. The deployment target is a locked-down Linux pod: **no Docker**, an internal npm mirror, Node 24 on glibc 2.28, and uncertainty about whether native module prebuilds will install. A server database (Postgres) or a server-mode graph DB (Neo4j) would each require infrastructure the environment can't guarantee.

## Decision

Use **SQLite as the single embedded store** (WAL mode, `busy_timeout`, foreign keys), accessed behind a small adapter. The adapter resolves its backend in this order: an explicit choice, then `better-sqlite3` if its native module loads, then **Node's built-in `node:sqlite`** — which needs zero native compilation.

## Consequences

- **No server, no Docker, no native-build risk on the pod.** If `better-sqlite3`'s prebuild won't install, the harness transparently falls back to `node:sqlite`; `loom doctor` reports which backend is live.
- The same test suite runs against **both backends** in CI, so the fallback is real, not theoretical (the adapter normalizes rowid types and uses savepoints for nested transactions on `node:sqlite`).
- We accept SQLite's single-writer model and design around it: the conductor is the sole writer of `loom.db`; the atlases are opened read-only outside their build stage.
- Graph queries over the code/UI atlases are expressed in SQL (+ FTS5, + optional vector search) rather than a graph query language — a deliberate trade for zero-infrastructure portability.
