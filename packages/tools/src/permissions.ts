import type { Hook } from './hooks.js';

/**
 * How the agent's tool calls are gated. A spectrum, not a boolean (adapted from
 * the approval-mode model in OpenAI Codex CLI, Apache-2.0, and Cline, Apache-2.0
 * — see docs/research/adopted-patterns.md):
 *   ask        — prompt before every mutating/expensive tool (reads run free)
 *   auto       — also auto-allow `safe` tools; prompt only for `expensive`
 *   allow-all  — never prompt (autonomous)
 *   deny       — block every tool
 */
export type PermissionMode = 'ask' | 'auto' | 'allow-all' | 'deny';

/** A tool's blast radius — drives the default decision (Cline's safe-tool safelist idea). */
export type ToolRisk = 'read' | 'safe' | 'expensive';

export type PermissionDecision = 'allow' | 'ask' | 'deny';

/** Mutable per-session policy: the mode plus tools explicitly allowed/denied this session. */
export type PermissionPolicy = {
  mode: PermissionMode;
  /** Tools the user chose "always allow" for this session. */
  readonly allow: Set<string>;
  /** Tools always blocked this session. */
  readonly deny: Set<string>;
};

export function createPolicy(mode: PermissionMode = 'ask'): PermissionPolicy {
  return { mode, allow: new Set(), deny: new Set() };
}

/**
 * Pure decision — given the policy and a tool's name + risk, allow / ask / deny.
 * Per-tool deny then allow win first (the session "always" memory); then the
 * mode: `deny` blocks all, reads are otherwise free, `allow-all` frees all,
 * `auto` frees `safe`, and `ask` prompts for anything not a read.
 */
export function decidePermission(
  policy: PermissionPolicy,
  tool: { name: string; risk: ToolRisk },
): PermissionDecision {
  if (policy.deny.has(tool.name)) return 'deny';
  if (policy.allow.has(tool.name)) return 'allow';
  if (policy.mode === 'deny') return 'deny';
  if (tool.risk === 'read') return 'allow';
  if (policy.mode === 'allow-all') return 'allow';
  if (policy.mode === 'auto') return tool.risk === 'safe' ? 'allow' : 'ask';
  return 'ask';
}

/** What the user can answer at an approval prompt (Cline's allow_once/allow_always + an allow-all escape). */
export type PermissionAnswer = 'yes' | 'no' | 'always' | 'all';

export type PermissionRequest = { name: string; risk: ToolRisk; input: unknown };
export type PermissionPrompt = (
  req: PermissionRequest,
) => Promise<PermissionAnswer> | PermissionAnswer;

/**
 * A `PreToolUse` hook that enforces a {@link PermissionPolicy} at the existing
 * L1 HookBus seam. For an `ask` decision it calls `prompt`; the answers mutate
 * the policy — "always" remembers the tool for the session, "all" flips the
 * whole policy to allow-all. Returning `{ block: true }` vetoes the tool call.
 */
export function permissionHook(
  policy: PermissionPolicy,
  riskOf: (name: string) => ToolRisk,
  prompt: PermissionPrompt,
): Hook {
  return async (payload) => {
    const { name, input } = (payload ?? {}) as { name?: string; input?: unknown };
    if (!name) return; // not a tool payload — nothing to gate
    const risk = riskOf(name);
    const decision = decidePermission(policy, { name, risk });
    if (decision === 'allow') return;
    if (decision === 'deny') {
      return {
        block: true,
        reason: `tool "${name}" denied by the ${policy.mode} permission policy`,
      };
    }
    const answer = await prompt({ name, risk, input });
    if (answer === 'yes') return;
    if (answer === 'always') {
      policy.allow.add(name);
      return;
    }
    if (answer === 'all') {
      policy.mode = 'allow-all';
      return;
    }
    return { block: true, reason: `you declined to run "${name}"` };
  };
}
