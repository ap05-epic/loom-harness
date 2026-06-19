---
name: test-driven-development
description: RED → GREEN → REFACTOR for each migrated component — write the failing test first, watch it fail, write the minimal code to pass, then clean up.
triggers: [tdd, test first, red green refactor, new feature, write test, failing test]
---

# Test-driven development

Write the test first. Watch it fail. Write the minimal code to pass. If you didn't watch it fail, you don't know it tests the right thing.

## The cycle

1. **RED** — one minimal test for one behavior. Run it; confirm it fails for the right reason (feature missing, not a typo).
2. **GREEN** — the simplest code that passes. No extra features, no speculative options.
3. **REFACTOR** — remove duplication, improve names; keep the test green, add no behavior.
4. Repeat for the next behavior.

## For a migrated screen

- Start from parity: a test asserting the rebuilt component renders the same fields and values the legacy screen did. Watch it fail (empty component), then build until green.
- A bug fix is a failing test that reproduces the bug first (`systematic-debugging`), then the fix.

## Don't

- Don't write code before the test "just this once" — delete it and start from the test.
- Don't test the mock; test real behavior.
