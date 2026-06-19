---
name: test-runner
description: Run the project's test suite (Vitest/Jest) on the rebuilt React/TS output and read the results — green before moving on, the failing test's message before any fix.
triggers: [test, vitest, jest, run tests, test failure, suite, coverage, red, green, npm test]
---

# Run the tests

Verify rebuilt code against its suite. Never report a screen "done" whose tests you haven't watched pass.

## Procedure

1. **Find the runner.** Read `package.json` `scripts.test` (loom output uses Vitest). Use the project's own command; don't invent flags.
2. **Run from the repo root**, not a single package — workspace runners resolve projects from the root. For one file, pass its path to the test command via `run_command`.
3. **Read the summary, not the noise.** Look at `Tests: N passed / M failed` and the first failing assertion's `expected` vs `received` with its `file:line`.
4. **One failure at a time.** Open the named test and the code it exercises; fix the code, not the test — unless the test encodes the wrong behavior.
5. **Re-run the same file** to confirm green, then the **full suite** to catch regressions.

## Notes

- A test that passes the instant you wrote it proves little — prefer writing it first (`test-driven-development`).
- Flaky? Run it again before assuming a bug; an intermittent pass means shared state or timing.
- Keep output pristine — an unhandled warning today is a failure tomorrow.
