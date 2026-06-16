/** Lifecycle events the hook bus dispatches (Pre/Post tool use, session, compaction). */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'SessionStart'
  | 'SessionEnd'
  | 'before_prompt_build'
  | 'before_compaction'
  | 'after_compaction';

/** A hook may veto with `{ block: true }`; returning nothing (void) allows. */
export type HookDecision = { block?: boolean; reason?: string } | void;

/** A hook receives the event payload and decides; async is allowed. */
export type Hook = (payload: unknown) => HookDecision | Promise<HookDecision>;

/** The outcome of emitting an event: blocked (with a reason) if any hook vetoed. */
export type EmitResult = { blocked: boolean; reason?: string };

/**
 * The lifecycle **hook bus**. Hooks run in registration order; the FIRST hook
 * that returns `{ block: true }` is **terminal** — remaining hooks for that
 * event don't run, and the emit reports `blocked`. Everything the agent does
 * (tool calls, prompt builds, compaction) flows through here, so policy
 * (protected paths, audit, budgets) lives outside the agent core.
 */
export class HookBus {
  private readonly hooks = new Map<HookEvent, Hook[]>();

  on(event: HookEvent, hook: Hook): this {
    const list = this.hooks.get(event) ?? [];
    list.push(hook);
    this.hooks.set(event, list);
    return this;
  }

  async emit(event: HookEvent, payload: unknown): Promise<EmitResult> {
    for (const hook of this.hooks.get(event) ?? []) {
      const decision = await hook(payload);
      if (decision && decision.block) {
        return { blocked: true, reason: decision.reason };
      }
    }
    return { blocked: false };
  }
}
