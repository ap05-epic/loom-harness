# Onboarding a real app (the BAA playbook)

How to take a fresh, undocumented legacy app from zero to mass-produced rebuilds on the pod. The example is **BAA** (Struts 1.x / JSP / Tiles → React 19 + TS); the steps are the same for any app — only the profile changes.

> Prereqs: the pod is set up per the [POD-RUNBOOK](POD-RUNBOOK.md) (`loom doctor` all-green, including `browser`, `proxy`, and `data-dir`). All project data lives in `LOOM_DATA_DIR`, **outside** any clone.

## 1. Profile + recon intake

Copy the template and fill it for the app (real values stay pod-side, never committed):

```bash
cp profiles/example/loom.config.example.yaml "$LOOM_DATA_DIR/loom.config.yaml"
# fill: source.strutsConfig, app.baseUrl (the trusted/prod deployment), crawl.auth (env-var creds)
```

If a prior analysis (e.g. a DIGIT `baa-analysis` `spec.md`/`status.md`) exists, drop it in the data dir — it's the richest possible input. The Mission Control **DIGIT** panel shows what's already in `~/.copilot` (skills/agents/MCP) to reuse.

## 2. MAP — recover the documentation

```bash
loom map --profile "$LOOM_DATA_DIR" --data-dir "$LOOM_DATA_DIR"
loom atlas summarize --data-dir "$LOOM_DATA_DIR"     # one grounded LLM doc per screen
loom atlas verify-docs --data-dir "$LOOM_DATA_DIR"   # consensus panel flags any the source doesn't support
loom atlas repomap --data-dir "$LOOM_DATA_DIR"       # whole-app overview; review in `loom ui`
```

This alone delivers the missing documentation. Fix any docs the panel flags before trusting them.

## 3. CRAWL — capture the trusted baseline

The baseline is the **most reliable deployment, usually production** (a local replica can be missing env hooks — [ADR 0005](../decisions/0005-production-as-baseline.md)). Prod-crawl safety is mandatory: read-only (no mutating posts; safe/test accounts), polite rate-limiting, aggressive PII masking, screenshots stay in the data dir.

```bash
loom crawl --profile "$LOOM_DATA_DIR" --data-dir "$LOOM_DATA_DIR"
```

Menu-driven shells (e.g. a `qpmenu`-style nav) often defeat synthetic URL nav — set `crawl.startPath` to the menu entry and lean on the AI-explorer. Cross-check coverage against the struts-config action inventory (static ground truth for "did we find every screen").

## 4. PLAN — work packages + the plan gate

The planner emits a screen inventory and dependency-ordered work packages (shared layout/components first, then screen groups). A human approves the **plan gate** in `loom ui` (or `loom gates approve`).

## 5. Pilot — 5 representative screens

Run BUILD → EVAL → FIX → ship-gate on five screens that exercise the hard cases: a simple form, a grid/table, a wizard, a popup-heavy screen, and a frameset/Tiles-heavy screen.

```bash
loom run --profile "$LOOM_DATA_DIR" --data-dir "$LOOM_DATA_DIR" \
  --screens login,deal-list,new-deal-wizard,pricing-overlay,schedule-layout --reflect
```

This calibrates thresholds, masks, skills, and budgets on the real app. Expect harness fixes here — that's what the `loom update` loop is for. Watch it live in `loom ui` (or `loom watch` over SSH); approve ship gates and answer any blocked-screen questions from the browser.

## 6. Mass production — the shift

```bash
loom run --profile "$LOOM_DATA_DIR" --data-dir "$LOOM_DATA_DIR" \
  --shift --max-parallel 4 --budget-tokens 4000000 --reflect --detach
```

Batches by dependency order; integration evals re-run cumulatively (a shared-component change can't silently regress a passed screen → stop-the-line). The Reflector accumulates app-specific skills, so conversion velocity rises — screen #50 is faster than screen #5; approved skills auto-promote to the bundled tier and lift in recall. Configure `LOOM_WEBHOOK_URL` for stop-the-line / shift-done pings. Review ship gates + the coverage ledger on a regular cadence.

## 7. Completion

The shift is done when the **coverage ledger** is 100% (every crawled state shipped or explicitly waived via a deviation gate) and the full-app integration eval is green. `loom report --kind stakeholder` produces the modernization report + per-screen parity evidence — the audit trail.

## API strategy

The established pattern is **new Spring Boot REST endpoints + React** (business logic reused/reimplemented, not raw form-post reuse). Work packages stay delivery-agnostic (strangler vs big-bang) until the bank decides how to ship.
