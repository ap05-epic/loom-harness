# ADR 0004 — Self-contained: no runtime dependency on external agent tooling

**Status:** Accepted (2026-06-15)

## Context

The target environment ships its own agent tooling (a Copilot-CLI wrapper with installable skills/agents, including ones that already do parts of this job — browser automation, screenshotting, even a legacy-analysis agent). It was tempting to build on top of them. But the harness has a second goal beyond this one app: **be reusable for any future modernization**, in environments that won't have that tooling. Depending on it would couple the harness to one company's stack and weaken the independent-judge guarantee (those agents self-verify).

## Decision

The harness is **fully self-contained**. It builds its own crawler, authentication/session handling, and evaluator, and depends on no external agent framework or company-specific runtime. Anything app- or environment-specific lives in a swappable **profile**. Interop is **one-way and optional**: we can _export_ skills to external tooling, never depend on it.

## Consequences

- **Portability.** The same harness runs against the first app and the next one, on the pod or anywhere else, with only a new profile.
- **We reimplement some things that already exist** in the target environment (e.g. SSO session capture, screenshotting). That's a deliberate cost paid for portability and for keeping the evaluator independent.
- We still _learn_ from the existing tooling (its proven approaches to auth and runtime quirks inform our profile and surveyor) without taking a dependency on it.
