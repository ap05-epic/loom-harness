---
name: systematic-debugging
description: Find the root cause before changing anything — reproduce, isolate, confirm the mechanism — so a misbehaving screen gets a real fix, not a band-aid.
triggers: [bug, debug, broken, root cause, regression, why is, unexpected, stack trace, reproduce, doesnt work]
---

# Debug to the root cause

Resist patching the symptom. A fix you can't explain is a fix that breaks again.

## Procedure

1. **Reproduce reliably.** Find the smallest input or route that triggers it. If you can't reproduce it, you can't confirm a fix.
2. **Read the actual error.** The top frame of the stack in *your* code is the lead; the message's exact words matter.
3. **Isolate.** Bisect — comment out or stash halves until one component, prop, or line is left. Capture it in a failing test (`test-runner`).
4. **One hypothesis about the mechanism** ("the date renders wrong because `getMonth()` is 0-based"). Confirm it by observation — a log, a breakpoint, the test — *before* fixing.
5. **Fix the cause, not the symptom.** Then re-run the reproducing test + the suite.

## Red flags

- "I'll just change this and see" — that's guessing, not debugging.
- A fix you can't explain in one sentence isn't understood yet.
- Three failed guesses → stop, re-read the error, re-isolate.
