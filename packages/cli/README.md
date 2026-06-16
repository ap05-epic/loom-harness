# @loom/cli

The `harness` command — a **thin presentation layer** over `core`/`agents`/`conductor`. Real logic lives in those packages; a command resolves context once, calls a domain function, and renders.

## Contract

- **Scriptable-first.** Every command supports `--json` (one result envelope on **stdout**, diagnostics as NDJSON on **stderr**, so `2>/dev/null` always yields clean JSON) and returns a **documented exit code** (`0 OK · 2 USAGE · 3 CONFIG · 4 GATE_REQUIRED · 5 BUDGET_EXHAUSTED · …`).
- **Interactive when it helps, never blocking.** Wizards (`init`, gate approvals) use prompts that degrade 1:1 to flags; in CI/non-TTY they take flags or fail clearly instead of hanging.
- **Uniform by construction.** Commands self-register via `defineCommand`; a `cli-conformance` test asserts every command has a description, an `OK` exit code, `--json`/`--quiet`, and flag coverage for each prompt.

See the [CLI guide](../../docs/guides/cli.md) and [Adding a command](../../docs/guides/extending/adding-a-command.md).

## Commands today

`init` · `doctor` · `status` · `update` · `db migrate|backup` · `profile show|validate` · `models list|test`. The pipeline/observe/work/knowledge groups land with their subsystems.

## Layout

```
bin.ts        thin: build program, parse, catch
program.ts    commander wiring, global flags, run wrapper, help epilog
context.ts    per-invocation CliContext (output mode, sink, lazy profile)
errors.ts     HarnessError + the exit-code table + mapError
registry.ts   defineCommand + the command registry
ui/           tty detection, the stdout/stderr sink, json envelopes, tables, colors
commands/     one module per command, grouped (lifecycle/pipeline/observe/work/knowledge)
```
