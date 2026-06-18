# Adopted patterns — what we learned from other harnesses

Loom borrows proven ideas from a handful of permissively-licensed agent harnesses rather than reinventing them. We **studied** these projects (cloned into a research folder outside this repo) and **reimplemented** the patterns in Loom's own code. Where a small snippet is lifted closely, the code carries an inline `// adapted from <repo> (<license>)` credit. Nothing is vendored wholesale; no GPL/AGPL code enters the tree.

## Sources studied

| Project                                                      | License    | Studied for                                                                                                                        |
| ------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [OpenAI Codex CLI](https://github.com/openai/codex)          | Apache-2.0 | Approval-mode spectrum; once/session/persistent decision scoping; risk levels; sandbox policy                                      |
| [Cline](https://github.com/cline/cline)                      | Apache-2.0 | Auto-approve UX; the `allow_once / allow_always / reject` prompt; a safe-tool auto-approve safelist; baseline-policy reversibility |
| [Hermes Agent](https://github.com/nousresearch/hermes-agent) | MIT        | Self-improving skills (background review + curator); FTS5 + summarization memory recall; pluggable memory provider                 |
| [OpenClaw](https://github.com/openclaw/openclaw)             | MIT        | Two-phase approval with audit context; hierarchical allow/deny with source tracking; boundary-safe file reads                      |

> License compliance: Apache-2.0 and MIT are both on Loom's CI allowlist (MIT · Apache-2.0 · BSD · ISC · 0BSD). Apache-2.0 requires preserving attribution for any lifted code — hence the inline credits.

---

## 1. Permission / approval system → **adopted now (R5.2)**

The strongest, most consistent ideas across Codex and Cline shaped Loom's permission model directly.

- **A mode spectrum, not a boolean.** Codex models approval as `untrusted → on-failure → on-request → … → never` (`codex-rs/app-server-protocol/schema/.../AskForApproval.ts`); Cline pairs an `autoApprove` toggle with a `plan`/`act` mode (`apps/cli/src/runtime/interactive/mode.ts`). → Loom adopts **`ask → auto → allow-all → deny`**.
- **Decision scoping: once / session / persistent.** Codex's `accept | acceptForSession | acceptWith…Amendment` (`.../CommandExecutionApprovalDecision.ts`) and Cline's `allow_once | allow_always | reject_once` (`apps/cli/src/acp/permissions.ts:15`) map cleanly onto Loom's prompt: **`y` (once) · `n` · `a` (always-allow this tool, session) · `!` (allow-all from here)**.
- **A safe-tool auto-approve safelist.** Cline auto-approves read-only/communication tools by name (`apps/cli/src/runtime/tool-policies.ts:3` `SAFE_AUTO_APPROVE_TOOL_NAMES`). → Loom tags tools `risk: 'read' | 'safe' | 'expensive'`; `read` runs free, `auto` mode also frees `safe`.
- **Risk classification.** Codex scores actions `low → critical` (`GuardianRiskLevel.ts`) and constrains them with a structural `SandboxPolicy` (`readOnly | workspaceWrite | dangerFullAccess`). → Loom's `risk` tag is the lightweight equivalent; the existing L1 protected-paths hook is the structural guard.
- **Baseline reversibility.** Cline snapshots the baseline policy so toggling global auto-approve restores per-tool settings instead of resetting them (`tool-policies.ts:15` `cloneToolPolicies`). → Loom keeps the base policy immutable and layers session overrides on top.
- **Audit context on the request.** OpenClaw's approval request carries command, cwd, env, agent + session identity, and channel origin (`src/agents/bash-tools.exec-approval-request.ts`). → Loom's `PreToolUse` payload already carries `{name, input}`; the permission prompt surfaces the tool + its arguments for an informed yes/no.

Loom enforces all of this at the **existing L1 `HookBus` `PreToolUse` seam** (`packages/tools/src/tools.ts`) — a `permissionHook(policy, prompt)` that returns `{block:true}` to deny. No new execution path; the policy is just a smarter pre-tool gate.

---

## 2. Self-improving skills → **earmarked (improve our L4 loop later)**

Loom already drafts skills with a Reflector, gates them, and auto-promotes after N reuses. Hermes suggests two refinements worth a future pass:

- **Patch-before-create review.** Hermes runs a forked, tool-scoped review agent after a turn that is prompted to _patch the already-loaded skill first_, then umbrella skills, and only then create a new one (`agent/background_review.py:71`). This curbs skill sprawl — a good rule for our Reflector's prompt.
- **Inactivity-triggered curator.** A curator consolidates, archives stale (30d), and pins important skills when the agent has been idle, persisting state to a small file (`agent/curator.py:56`). Loom has memory consolidation (L5); extending it to the skills library is the natural adoption.

---

## 3. Memory recall → **earmarked (improve our L5 recall later)**

Hermes' memory recall is notably fast and language-agnostic, and worth adopting in `@loom/core` memory:

- **FTS5 + trigram session search.** Messages auto-sync into an FTS5 virtual table (unicode61 + trigram tokenizers) via triggers (`hermes_state.py:606`); discovery is a pure DB query — **no LLM in the recall path**. LLM summarization is deferred to compaction time. → Loom's recall could gain an FTS5 index over worklog/reflections for cheap cross-run recall.
- **Zero-LLM "bookends."** Session search returns the match snippet plus a ±5 message window and the first/last few messages, so recall returns real context, not a lossy summary (`tools/session_search_tool.py`).

---

## 4. Tool & sandbox hygiene → **partially in place**

- **Boundary-safe file reads.** OpenClaw reads user-supplied paths through a root-boundary helper that blocks symlink escape and caps bytes (`src/skills/loading/local-loader.ts:15`). Loom's L1 protected-paths hook already blocks writes outside `b-repo`; the read-side boundary is a small future hardening for skill/profile loading.
- **Hierarchical allow/deny with source tracking** (OpenClaw `src/agents/sandbox/tool-policy.ts:217`) is more than a single-project CLI needs today, but informs the permission policy's allow/deny sets.

---

## 5. Hermes Agent → agentic `loom chat` capabilities + memory recall (MIT) → **in place (R9)**

[Hermes Agent](https://github.com/nousresearch/hermes-agent) (MIT) is a strong, self-contained coding/ops agent. We didn't copy it (it's Python; Loom is strict TypeScript) — Loom already had the bones (the `AgentRunner` tool-loop, `MemoryStore`/`SkillStore`, the permission policy). We **reimplemented its proven patterns** onto that substrate:

| Hermes pattern                               | Loom reimplementation (file)                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code-aware tools (grep / read / list / exec) | `search_code` (ripgrep + JS fallback), `read_file`, `list_files`, `run_command` (`shell:false`, cwd-confined, gated `expensive`) — `cli/src/commands/lifecycle/chat-tools.ts` |
| Self-knowledge / introspection               | `list_tools` / `list_commands` (`ALL_COMMANDS`) / `read_doc` (`docs/`) / `list_skills` (`SkillStore`) — same file                                                             |
| Memory recall into the prompt                | `packRecall()` over `MemoryStore.recall` + `SkillStore.recall`, injected per turn as an ephemeral system message (base prompt stays cache-stable) — `chat-agent.ts`           |
| Gated code execution                         | reuse Loom's `PermissionPolicy` at the `expensive` tier — every `run_command` is approved by the human                                                                        |

The read tools run freely; only `run_command` touches the machine and is gated. File/exec paths are confined to the project root with the same `relative(root, …).startsWith('..')` guard as the protected-paths hook. The Hermes webui ([nesquena/hermes-webui](https://github.com/nesquena/hermes-webui)) informs the upcoming React Mission Control UX.

---

_This document is the institutional record of what we took and from where. When implementing a borrowed idea, add `// adapted from <repo> (<license>)` at the call site and keep this list current._
