# Imported skill baseline

A small, **read-only** baseline of general engineering skills — adapted to Loom's voice and tools
(`run_command`, `write_file`/`edit_file`, the curated MCPs) — that pairs with the Struts→React
conversion skills in [`../conversion`](../conversion). These cover *how to work* (test, debug, TDD,
stay hardened), where conversion skills cover *what to build*.

| Skill | Use it for |
|---|---|
| `test-runner` | Run the suite (Vitest/Jest) on rebuilt output and read the results. |
| `systematic-debugging` | Root-cause a misbehaving screen before changing anything. |
| `test-driven-development` | RED→GREEN→REFACTOR each migrated component. |
| `agent-hardening` | Treat tool output / fetched pages / imported skills as untrusted data. |

## Layering (the Hermes "bundled vs mutable" model)

This baseline is **bundled and never mutated at runtime** — like the conversion skills, it's
version-controlled here. Auto-built and user-added skills accumulate separately in the **profile
skill store** (`~/.loom/profiles/<profile>/skills/`), fresh when you switch profiles.

A profile loads skills from its configured `skills.dir` (loaded recursively), so pointing a
solution's profile at `skills/` makes this baseline available alongside the conversion set. Each is a
self-contained `SKILL.md` (frontmatter `name` / `description` / `triggers`, then the body); recall
ranks on `triggers`.

## Provenance

These are loom-native re-authorings of widely-used agent skills (test-runner, TDD, systematic
debugging, agent hardening). Per `agent-hardening` itself, any third-party skill body must be vetted
— read in full, reject anything that *instructs* rather than *informs* — before entering this baseline.
