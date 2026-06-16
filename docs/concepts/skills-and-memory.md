# Skills & memory — the self-improvement loop

Loom gets **faster and cheaper the longer it runs** on a codebase. Screen #50 converts in
fewer attempts than screen #5 because the harness distils what worked into reusable **skills**
and durable **memory**, then recalls them into later work orders. This is the mechanism that
also makes the harness transferable to the _next_ legacy project: skills are the distilled
migration knowledge, not throwaway scratch.

Two stores back this loop, both in `loom.db` and both recalled by the context packer:

- **Skills** (`SkillStore`, `packages/core/src/skills/skills.ts`) — procedures: "convert a
  `<logic:iterate>` table to a React table", "Tiles layout → layout component".
- **Memory** (`MemoryStore`) — facts and history: project conventions, and the per-WP
  **worklog** of what was tried and why it failed.

---

## Skills

### What a skill is

A skill is a Markdown file with frontmatter (agentskills.io-compatible) — `name`,
`description`, `triggers`, and a body that _is_ the procedure. `@loom/skills` parses and
serializes this format (`parseSkillMd` / `serializeSkillMd`), loads a directory of them
(`loadSkillDir`), and ranks them against a work order (`rankSkillDocs`). The same skills live
as rows in `skills_index` so they can carry usage statistics.

### Tiers

Where a skill comes from determines its scope:

| Tier        | Scope                                          | Origin                                         |
| ----------- | ---------------------------------------------- | ---------------------------------------------- |
| `bundled`   | **global** — every project (`project` is null) | ships with the harness                         |
| `project`   | one project's conventions                      | authored in the profile directory              |
| `generated` | starts project-scoped                          | **drafted by the Reflector** after a passed WP |

`project`-tier skills never become global — their conventions are project-specific and must
not leak across clients. Only `generated` skills can graduate (see _Auto-promotion_).

### Lifecycle: draft → human gate → active → recall

```
Reflector drafts ──▶ status=draft ──▶ human approves (skill gate) ──▶ status=active ──▶ recalled by relevance
```

1. **Draft.** After a screen passes, the **Reflector** (`reflect`,
   `packages/agents/src/reflect.ts`) extracts reusable lessons and writes them as `draft`
   skills (and, if `--reflect` set a `skillsDir`, as `SKILL.md` files on disk). A draft also
   opens a **skill gate** so a human reviews it.
2. **Approve.** The human activates the draft (`loom gates approve`, or `SkillStore.setStatus`
   → `active`). **The harness never activates a skill on its own** — the gate is never skipped.
3. **Recall.** When building a screen, `recallForWorkOrder`
   (`packages/agents/src/context/recall.ts`) pulls the **active** skills (global + this
   project's) whose name/description/triggers best match the work order, and the conductor's
   `buildWorkOrder` places them high in the order. Recall ranks by term overlap, then by
   `success_count`, then `use_count` — so the most-proven skill surfaces first.

### Usage accounting & auto-promotion

Every skill recalled into a work order is **credited with that screen's outcome**. When a WP
passes or blocks, the conductor calls `SkillStore.recordUse(id, { success })` for each recalled
skill (`recordSkillOutcome` in `packages/conductor/src/pipeline.ts`). Those counts drive recall
ranking — and one promotion rule:

> **Human-approve, then auto-promote.** A human still approves every draft once. Thereafter, an
> **`active`, `generated`** skill that reaches **N successful reuses** (`DEFAULT_PROMOTE_AFTER`
> = 3; override with `loom run --skill-promote-after <n>`) **auto-promotes to the `bundled`
> tier** (`project` → null). It becomes global and — via its higher `success_count` — ranks
> higher in recall everywhere.

The guardrails are deliberate and tested:

- A **`draft`** skill is **never** auto-promoted — the human gate is never bypassed.
- A **`project`** skill is never promoted — its conventions stay project-scoped (no cross-client
  leak).
- Only **successes** count toward the threshold; a failure never tips a skill over.
- Promotion emits a `skill.promoted` event so Mission Control (and a human) can see the loop
  compounding.

This is the only place the harness "auto-approves" anything, and it only _graduates an
already-human-approved, already-proven skill_ — it never turns an unreviewed draft loose.

### Interop: DIGIT export / import

Loom's `SKILL.md` _is_ the agentskills.io / DIGIT format (the same shape DIGIT reads from
`~/.copilot/skills/<name>/SKILL.md`), so sharing skills with colleagues' Copilot/DIGIT tooling
is a faithful, **one-way-optional round-trip** — never a runtime dependency:

- `loom skills export --target digit --out <dir>` writes the project's library as
  `<dir>/<name>/SKILL.md`.
- `loom skills import --from <dir>` pulls external `SKILL.md` files into the project's
  `skills.dir`.

Both run on the `copySkillDir` helper (`packages/skills/src/transfer.ts`), which re-serializes
each file through the parser — so the output is normalized, valid `SKILL.md` and a malformed
file is skipped rather than fatal. Export then import yields byte-identical skills.

---

## Memory

`MemoryStore` holds three kinds of recalled context, scoped per project:

- **Project facts** (`project_fact`) — stable conventions discovered while working ("dates
  render `dd.MM.yyyy`", "API base path is `/app/api`"). Recalled by relevance into the order.
- **Worklog** (`worklog`) — the OpenClaw task-flow pattern: per WP, what an attempt tried and
  why it failed. Written on every failed attempt and packed into the next attempt so the Fixer
  **never repeats a dead end**.
- **Reflections** (`reflection`) — per-shift distillations: progress, recurring failure
  patterns (candidate skills), budget burn.

Project memory never leaks into another project; only the `bundled` skill tier is shared
across projects.

---

## Why this is safe

- The deterministic 7-layer **evaluator** remains the source of truth for whether a rebuild
  passes — skills make the Builder _faster_, never the _judge_ more lenient.
- Gates (skill, ship, plan, deviation) are queued for humans, never auto-approved — the single
  exception is the proven-skill graduation above, which can't introduce anything a human hasn't
  already reviewed.
- Recall is bounded and relevance-ranked, so the context packer's skill slot stays small and
  the most useful knowledge survives under budget pressure (see
  [Context packing](context-packing.md)).
