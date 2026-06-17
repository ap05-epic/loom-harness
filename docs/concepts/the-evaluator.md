# The evaluator (the judge)

The evaluator answers one question automatically and at scale: **does this rebuilt screen faithfully match the original?** It is deterministic and LLM-free so it can be trusted ([ADR 0003](../decisions/0003-deterministic-evaluator.md)).

## Why LLM-free

If an LLM judged parity — especially the model that did the building — it could be argued with, drift run-to-run, or be reward-hacked (e.g. embedding a screenshot of the legacy screen to fool a vision check). So the judge is pure code, runs in a clean checkout the building agent can't touch, and is **mutation-tested in both directions**: it must pass faithful rebuilds _and_ fail sabotaged ones, naming the offending screen.

## The layers

The evaluator is a stack of deterministic checks; each emits machine-readable verdicts the fixer consumes. A screen passes only when **every active gate** passes — the verdict is an AND, so one missing dropdown option fails the screen even at 0% pixel diff. `evaluateScreen` (in the conductor) is the single definition of "does this screen pass parity," shared by the per-attempt loop and the cross-screen integration eval.

**Always on** — the conductor runs these four on every screen:

1. **Visual** — `diffImages` does a masked pixel diff per state × viewport (× interaction state as it deepens); `scoreVisual` passes only if every capture is within its threshold. Mutation-tested both directions.
2. **Structural / DOM** — `diffDom` does a normalized tree compare (tags, roles, semantic attributes like input `name`/`type`, link targets, labels, `<select>` option lists) and reports each difference with a readable path + reason code. Catches what a pixel gate can't — a missing dropdown option, a text→password swap, a relabelled control, a dropped field. A pixel-perfect rebuild that drops an option is still blocked. Calibrated both directions.
3. **Computed-style** — `diffStyles` compares per-element style digests (typography, colour, borders, spacing — not layout dimensions) captured by `captureDom`. Catches sub-threshold "death by 1px" drift a pixel gate is too coarse to see. Calibrated both directions.
4. **Functional / validation** — `diffForms` compares every legacy form field and validation rule (required, maxlength, pattern, option lists, input types) against the rebuild; any field or rule the rebuild dropped or changed fails the gate.

**Enabled by a seam** — built and wired, but off unless you supply the capture:

5. **Accessibility** — `diffA11y` compares axe-core violations A-vs-B. Supply an `a11yCapture` (axe in the browser) and a rebuild that is _less_ accessible than the legacy screen fails.
6. **Anti-cheat** — `findCopiedAssets` scans the rebuilt bundle for files byte-identical to legacy source assets. Supply the legacy `legacyAssets` digests and a smuggled-in original fails the gate. (The structural gate already defeats the screenshot-embed cheat, since a screenshot has none of the real controls.)

**On the roadmap:**

7. **Behavioural replay** — recorded legacy flows re-run on the rebuild: same inputs → equivalent requests (HAR mapping form-POST → API) and equivalent end-state, including negative cases (every validation rule fired with boundary/invalid inputs, error messages per field). This is the one originally-planned layer not yet built.

## Thresholds and human judgement

The default gate is unforgiving. Where a difference is acceptable, a reviewer approves a **per-screen deviation** (raising that screen's threshold) — the only way thresholds move.

The **coverage ledger** (`coverageLedger`) is the "no screen left behind" guarantee: it reconciles the MAP's static inventory, what the crawler actually reached, and what's been rebuilt, and flags every gap — a static screen the crawl missed, a runtime-only screen with no plan, and any discovered screen not yet built. `notBuilt` must be empty before the ship gate opens.

## Symmetry

The evaluator compares any two deployments, so the same machinery that scores legacy-vs-rebuild also runs a **local-vs-production fidelity check** ([ADR 0005](../decisions/0005-production-as-baseline.md)).

## Consensus for the subjective calls

The seven layers are deterministic and stay the **source of truth** for visual, structural, and behavioral parity. But some calls are genuinely subjective — is a _recovered doc_ accurate? is a _plan_ sound? is an _ambiguous_ parity difference acceptable? For those, a cost-bounded **consensus panel** (`judgePanel`) runs N independent, skeptical judges over a claim + its evidence and returns a quorum verdict (strict majority by default; an unparseable judge counts as a reject). It never touches the deterministic gates — it only adjudicates the judgement calls the gates can't.

The first use is recovered-doc verification: `verifyScreenDocs` (and `loom atlas verify-docs`) puts each generated screen doc to the panel against the same atlas facts it was generated from, flagging docs the source doesn't support — catching a doc that _reads_ fine but claims a control the legacy screen never had.
