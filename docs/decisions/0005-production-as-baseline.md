# ADR 0005 — Production is the parity baseline when the local replica is unreliable

**Status:** Accepted (2026-06-15)

## Context

Parity is measured against the _legacy_ side of an A/B comparison — so the legacy capture must be trustworthy. In the first target environment, the locally-runnable replica sometimes does not behave like production (missing hooks that only exist in the working QA/prod environment). If we baselined against an unfaithful local copy, we could "prove" a rebuild correct against something that itself is wrong.

## Decision

Capture the legacy baseline from the **most reliable deployment — production** — when the local replica can't be trusted. A profile carries a `legacyBaseUrl` (the trusted source) separate from an optional `devUrl` (local). Because the parity evaluator is **symmetric**, the same machinery also provides a **fidelity/drift check** comparing local against production, flagging exactly which local screens are untrustworthy — the "is local even replicating prod?" question becomes an evaluator _mode_, not new infrastructure.

## Consequences

- **The baseline is trustworthy**, and we gain a free tool to audit the local replica's fidelity.
- Crawling a **live production system** carries real risk, so the surveyor has a mandatory **safe mode**: read-only only (no mutating form submissions; safe/test accounts), polite rate-limiting, and never destructive.
- **Production screenshots contain real data** and are treated as highly sensitive: they live only in the data directory (outside any repo), are never committed, and get aggressive masking of dynamic/personal regions.
