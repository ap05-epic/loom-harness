# @loom/core

Foundational types and durable storage for the harness. Depends on nothing else in the workspace.

## What it provides

- **SQLite, the safe way** — `openSqlite(path)` opens a database behind a backend-neutral interface, preferring native `better-sqlite3` and falling back to Node's built-in `node:sqlite` if the native module can't load (zero compilation). `openDb(path)` adds the standard pragmas (WAL, `synchronous=NORMAL`, `busy_timeout`, foreign keys). See [ADR 0002](../../docs/decisions/0002-sqlite-node-sqlite-fallback.md).
- **Migrations** — `runMigrations(db, MIGRATIONS)` applies forward-only migrations atomically and idempotently; `MIGRATIONS` is the ordered list for `loom.db`.
- **Event log** — `new EventLog(db)` is the append-only observability spine: `append(event)` and `tailFrom(cursor, limit, filter)` with a `run → work_package → attempt` correlation chain.
- **Config** — `loadProfile(dir, { env, dataDir })` reads and validates `loom.config.yaml`, merges `.env`, and **refuses a data directory inside a git working tree** (so project data never lands in a repo).
- **Ids** — `newId(prefix?)` returns sortable, URL-safe identifiers.

## Example

```ts
import { openDb, runMigrations, MIGRATIONS, EventLog } from '@loom/core';

const db = openDb('/data/loom.db');
runMigrations(db, MIGRATIONS);
const log = new EventLog(db);
log.append({ type: 'run.started', payload: { stage: 'map' }, runId: 'run_1' });
console.log(db.backend); // 'better-sqlite3' | 'node:sqlite'
```

## Tested

Unit tests cover the migrations runner, the event log, the config loader's validation and git-tree refusal, and the SQLite adapter **against both backends**.
