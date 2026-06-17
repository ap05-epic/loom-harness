---
name: large-screen-decomposition
description: Rebuild a dense legacy screen with 50+ interactive controls without losing any behavior — decompose into components while keeping exact layout + validation.
triggers: [large screen, 50 controls, dense form, many fields, complex screen, decomposition]
---

# Decomposing a 50+-control screen

Big legacy screens (dozens of fields, buttons, sub-tables, tabs) overflow a single component and are easy to get subtly wrong. Decompose methodically so nothing is dropped.

## Procedure

1. **Inventory first, build second.** From the crawl + JSP, list EVERY interactable: each field (name, type, maxlength, required, default, options), each button/link (action + params), each table/section, each tab. This inventory is the checklist the coverage ledger enforces — no control left behind.
2. **Cut along the legacy's own seams.** Group by the sections the JSP already has (fieldsets, panels, Tiles regions, tabs). Each becomes a child component; the screen is their composition. Don't re-flow the layout.
3. **Lift shared state to the screen.** Cross-field behavior (a field that enables another, a running total) lives in the screen's state; children stay mostly presentational + emit changes.
4. **Port validation per field, including negatives.** Reproduce every rule (required/maxlength/pattern/range) AND the exact error message + where it renders. The functional layer fires each rule with boundary/invalid/empty input.
5. **Reproduce tab/disabled/visibility logic** exactly — a tab hidden by role, a field disabled until another is set. The evaluator replays these.
6. **Reconcile against the inventory** before calling it done: every control in step 1 is present, wired, and validated.

## Parity gotchas

- Hidden inputs carry state the server needs — keep them (or a modern equivalent), even if invisible.
- A single "Save" button may post different params depending on a mode flag — preserve each path.
- Duplicate field names (a Struts indexed property `item[0].x`) map to **array state**, not 50 separate fields.
