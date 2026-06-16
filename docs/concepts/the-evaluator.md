# The evaluator (the judge)

The evaluator answers one question automatically and at scale: **does this rebuilt screen faithfully match the original?** It is deterministic and LLM-free so it can be trusted ([ADR 0003](../decisions/0003-deterministic-evaluator.md)).

## Why LLM-free

If an LLM judged parity — especially the model that did the building — it could be argued with, drift run-to-run, or be reward-hacked (e.g. embedding a screenshot of the legacy screen to fool a vision check). So the judge is pure code, runs in a clean checkout the building agent can't touch, and is **mutation-tested in both directions**: it must pass faithful rebuilds _and_ fail sabotaged ones, naming the offending screen.

## The layers

The evaluator grows into seven deterministic layers; each emits machine-readable verdicts the fixer consumes. Built today:

1. **Visual** — `diffImages` does a masked pixel diff per state × viewport (× interaction state as it deepens); `scoreVisual` passes only if every capture is within its threshold. Built and mutation-tested.
2. **Structural / DOM** — `diffDom` does a normalized tree compare (tags, roles, semantic attributes like input `name`/`type`, link targets, labels, `<select>` option lists) and reports each difference with a readable path + reason code. This catches what a pixel gate can't — a missing dropdown option, a text→password swap, a relabelled control, a dropped field. The browser's `captureDom` extracts the normalized tree; the conductor runs it as a **second gate** alongside visual (a pixel-perfect rebuild that drops an option is still blocked). Calibrated both directions.
3. **Computed-style** — `diffStyles` compares per-element style digests (typography, colour, borders, spacing — not layout dimensions) captured by `captureDom`. Catches sub-threshold "death by 1px" drift a pixel gate is too coarse to see, and runs as a **third gate** in the conductor. Calibrated both directions.

Landing as the evaluator deepens:

4. **Behavioural replay** — recorded legacy flows re-run on the rebuild; same inputs → equivalent requests and end-state; includes negative cases (every validation rule, boundary/invalid inputs, error messages per field).
5. **Functional micro-checks** — auto-generated per-form matrices (required, validation, maxlength, tab order); sort/filter/pagination for tables.
6. **Accessibility & hygiene** — axe-core, accessibility-tree compare, zero console errors.
7. **Anti-cheat** — real interactive controls present (no screenshot/base64 walls), no copied legacy assets.

## Thresholds and human judgement

The default gate is unforgiving. Where a difference is acceptable, a reviewer approves a **per-screen deviation** (raising that screen's threshold) — the only way thresholds move.

The **coverage ledger** (`coverageLedger`) is the "no screen left behind" guarantee: it reconciles the MAP's static inventory, what the crawler actually reached, and what's been rebuilt, and flags every gap — a static screen the crawl missed, a runtime-only screen with no plan, and any discovered screen not yet built. `notBuilt` must be empty before the ship gate opens.

## Symmetry

The evaluator compares any two deployments, so the same machinery that scores legacy-vs-rebuild also runs a **local-vs-production fidelity check** ([ADR 0005](../decisions/0005-production-as-baseline.md)).

## Consensus for the subjective calls

The seven layers are deterministic and stay the **source of truth** for visual, structural, and behavioral parity. But some calls are genuinely subjective — is a _recovered doc_ accurate? is a _plan_ sound? is an _ambiguous_ parity difference acceptable? For those, a cost-bounded **consensus panel** (`judgePanel`) runs N independent, skeptical judges over a claim + its evidence and returns a quorum verdict (strict majority by default; an unparseable judge counts as a reject). It never touches the deterministic gates — it only adjudicates the judgement calls the gates can't.

The first use is recovered-doc verification: `verifyScreenDocs` (and `loom atlas verify-docs`) puts each generated screen doc to the panel against the same atlas facts it was generated from, flagging docs the source doesn't support — catching a doc that _reads_ fine but claims a control the legacy screen never had.
