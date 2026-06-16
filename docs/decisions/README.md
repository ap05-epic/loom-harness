# Architecture Decision Records

Each ADR captures one significant choice: the context, the decision, and the consequences. They are immutable once accepted — to change a decision, add a new ADR that supersedes the old one.

| #                                           | Decision                                                               | Status   |
| ------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| [0001](0001-model-b-direct-llm.md)          | Model B — the harness owns the agent loop (direct LLM calls)           | Accepted |
| [0002](0002-sqlite-node-sqlite-fallback.md) | SQLite as the store, with a `node:sqlite` fallback                     | Accepted |
| [0003](0003-deterministic-evaluator.md)     | The evaluator is deterministic and LLM-free                            | Accepted |
| [0004](0004-self-contained.md)              | Self-contained — no runtime dependency on external agent tooling       | Accepted |
| [0005](0005-production-as-baseline.md)      | Production is the parity baseline when the local replica is unreliable | Accepted |

New ADRs follow the same short format: **Context** (the forces at play) → **Decision** (what we chose) → **Consequences** (what follows, good and bad).
