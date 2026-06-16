# How you interact with Loom

Loom is **not a chatbot.** It's a command-driven, autonomous pipeline with a human in the loop. You don't converse with it to get work done — you point it at a legacy app, it runs for minutes to hours, and you supervise. Knowing this up front saves the "wait, how do I talk to it?" moment.

## The three ways you interact

**1. Pipeline commands — you drive the stages.**

```
loom map → loom crawl → loom run [--shift] → loom resume / loom stop
```

`map` scans the legacy source into the CodeAtlas (and writes the docs it never had); `crawl` captures the running app as the trusted baseline; `run` rebuilds each screen, judges it across the [seven evaluator layers](the-evaluator.md), and fixes failures. `--shift` runs it unattended under [safeguards](the-conductor.md). `loom next` will always tell you which command comes next from your current state.

**2. Human-in-the-loop decisions — the harness asks, you answer.**

A shift doesn't stop to chat; it queues decisions and keeps working on un-gated work. You clear them when convenient:

- `loom gates list | approve | reject` — plan, deviation, ship, and new-skill gates.
- `loom questions list | answer` — a blocked screen escalates here with its worklog.
- `loom watch` (terminal) or `loom ui` (Mission Control web app) — see live progress, budgets, and the inbox; the web app writes gate/question decisions back.

This _is_ the conversation — structured approvals and answers, not free text.

**3. A direct line to the model — for sanity checks and quick questions.**

```bash
loom ask "what does this struts-config snippet define?"   # one-off (prompt arg or piped stdin)
loom chat                                                  # interactive REPL (/exit to quit)
```

`ask`/`chat` send straight to your configured model and print the reply. They're a convenience on top of the same gateway the pipeline uses — not a way to drive the rebuild. Use them to confirm the model works (`loom ask "say pong"`), draft a note, or ask a question; use the pipeline to actually modernize an app.

## Where the model fits (and what Copilot is)

Every "thinking" step — writing docs, writing the rebuild, deciding what to click — calls a model through one swappable **gateway driver**:

- **`openai`** — a direct OpenAI/Azure endpoint (`LLM_BASE_URL` + `LLM_API_KEY`). The reliable default; it authenticates Azure's `…/openai/v1` surface out of the box.
- **`copilot`** — a **GitHub Copilot login** (no key/URL; auth from your `copilot login` session). Convenient where you have a Copilot login but no key.
- **`anthropic`** — for portability outside the bank.

The Copilot CLI is just a **transport** — one of three ways to reach a model. It is _not_ the brain: the scanners, crawler, evaluator, conductor, skills, and Mission Control are all Loom's. Swap the driver and the whole pipeline runs identically. `loom models list` shows which is active; `loom models test` probes it live.

## Not a chatbot — by design

There is no "tell Loom in English to rebuild screen X." The pipeline is deterministic and resumable so an 8-hour unattended shift is safe, auditable, and repeatable — properties a chat loop can't give you. The English-language reasoning happens _inside_ each agent step (Planner, Builder, Fixer, Explorer); you steer the whole thing with commands and approvals.

## See also

- [The CLI](../guides/cli.md) — every command, the `--json` contract, exit codes.
- [The conductor](the-conductor.md) — shift mode, the work-package state machine, safeguards.
- [LLM gateway & drivers](llm-gateway-and-drivers.md) — the three-driver abstraction.
