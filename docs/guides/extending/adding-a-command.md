# Adding a CLI command

Commands are declarative specs. The framework handles parsing, the `--json` contract, exit-code mapping, and rendering — you write the logic and the human view.

## 1. Define the spec

Create a module under `packages/cli/src/commands/<group>/`:

```ts
import { defineCommand } from '../../registry.js';

export const helloCommand = defineCommand({
  name: 'hello', // a space means a subcommand path: 'wp list'
  group: 'lifecycle', // lifecycle | pipeline | observe | work | knowledge
  describe: 'Say hello',
  exitCodes: ['CONFIG'], // OK is always added
  options: [{ flags: '--loud', describe: 'shout it' }],
  examples: ['harness hello --loud'],
  run(ctx, input) {
    // ctx = CliContext; input = { options, args }
    const name = ctx.requireProfile().project; // throws CONFIG if no profile
    return { greeting: input.options.loud ? `HELLO ${name}!` : `hello ${name}` };
  },
  render(data, ctx) {
    // optional human view; --json uses the returned data
    ctx.sink.line((data as { greeting: string }).greeting);
  },
});
```

Key points:

- `run` returns plain JSON-able **data**. In `--json` mode the framework wraps it in the success envelope; in human mode it calls `render` (or pretty-prints the data).
- Throw a `HarnessError` (or a factory like `usageError`, `configError`, `notFoundError`) to fail with the right code; everything else becomes `INTERNAL` (70).
- To exit non-zero on an otherwise-successful run (like `doctor` with failures), call `ctx.requestExit(code)`.
- Diagnostics go through `ctx.sink.info/warn/error` (stderr); the single result goes through the return value.

## 2. Register it

Add it to `ALL_COMMANDS` in `packages/cli/src/commands/index.ts`.

## 3. The conformance test does the rest

`cli-conformance.test.ts` will now require your command to have a description, an `OK` exit code, `--json`/`--quiet`, and — if it prompts — a flag for each prompt. Write your unit test by calling `run(ctx, input)` with an in-memory context; no process spawning needed.
