# Adding an evaluator layer

The evaluator is the judge, so a new layer must be **deterministic, LLM-free, and mutation-tested in both directions** ([ADR 0003](../../decisions/0003-deterministic-evaluator.md)). A layer turns captured evidence about two deployments into a verdict with explicit reason codes.

## The shape of a layer

A layer is a pure function from captures to a verdict:

```ts
// pseudo-shape, mirroring scoreVisual
type LayerVerdict = {
  passed: boolean;
  failures: Array<{ state: string; viewport?: string; reason: string; detail?: unknown }>;
  // ...whatever the layer measures (worst diff, mismatched fields, missing options, ...)
};

export function scoreStructural(pairs: DomPair[], options: StructuralOptions): LayerVerdict { … }
```

Rules:

- **No LLM calls, no network for the decision.** Inputs are concrete (PNGs, normalized DOM, computed styles, recorded request/response pairs, axe results). If you need a browser to _capture_ evidence, do that in the surveyor; the layer only _compares_.
- **Name what failed.** Verdicts identify the offending screen/state and give a machine-readable reason code, so the fixer can act and a human can review.
- **Honor per-screen deviations.** Thresholds move only via a human-approved deviation, never silently.

## Mutation tests are mandatory

Every layer ships with tests proving it judges correctly in both directions:

- a **faithful** rebuild **passes**;
- a **sabotaged** rebuild **fails**, with the right reason and screen — and the sabotage must be the kind this layer is meant to catch (e.g. a missing dropdown option for the structural layer, a wrong validation message for behavioural replay, a screenshot-embed for anti-cheat).

Use synthetic inputs where possible (as the visual layer does with generated PNGs) so tests are fast and deterministic in CI.

## Compose into the scorecard

Add the layer's verdict to the work-package scorecard and the coverage ledger, so "every discovered rule is asserted somewhere" stays true and the ship gate sees the full picture.
