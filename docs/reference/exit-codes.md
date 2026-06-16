# Exit codes

Every `harness` command returns one of these. They are a **stable contract** — cron jobs and CI scripts branch on them (e.g. treat 4/5 as "page a human," 8 as "retry later"). The same table prints in `loom --help`.

| Code | Name             | Meaning                                                             |
| ---- | ---------------- | ------------------------------------------------------------------- |
| 0    | OK               | Success                                                             |
| 1    | RUNTIME          | A handled runtime failure                                           |
| 2    | USAGE            | Bad flags/args, or missing required input in non-interactive mode   |
| 3    | CONFIG           | Profile / env / data-dir invalid or unresolved                      |
| 4    | GATE_REQUIRED    | Work paused awaiting a human gate (plan / deviation / ship / skill) |
| 5    | BUDGET_EXHAUSTED | A token / cost / time budget was hit before completion              |
| 6    | GUARD_TRIPPED    | A safeguard blocked the action (write outside the sandbox, etc.)    |
| 7    | BLOCKED          | A work package or dependency is blocked; nothing runnable           |
| 8    | NETWORK          | The proxy, npm mirror, or LLM endpoint was unreachable              |
| 9    | NOT_FOUND        | A referenced run / work-package / gate / skill id does not exist    |
| 70   | INTERNAL         | Unexpected/unhandled (the stack prints only under `--verbose`)      |
| 130  | INTERRUPTED      | SIGINT/SIGTERM during a run (a graceful drain is attempted)         |

In `--json` mode a failure is also a structured envelope on stdout:
`{ "ok": false, "command": "…", "error": { "code", "message", "hint?", "docs?" } }`.
