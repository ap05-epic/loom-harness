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
 * The core gate — used by both the agentic chat (which calls tools directly) and
 * {@link permissionHook}. Decide → for an `ask` decision, prompt → apply the
 * answer (mutating the session policy: "always" remembers the tool, "all" flips
 * the whole policy to allow-all). Returns whether the call may proceed.
 */
export async function checkPermission(
  policy: PermissionPolicy,
  riskOf: (name: string) => ToolRisk,
  prompt: PermissionPrompt,
  req: { name: string; input: unknown },
): Promise<{ allowed: boolean; reason?: string }> {
  const risk = riskOf(req.name);
  const decision = decidePermission(policy, { name: req.name, risk });
  if (decision === 'allow') return { allowed: true };
  if (decision === 'deny') return { allowed: false, reason: `denied by the ${policy.mode} policy` };
  const answer = await prompt({ name: req.name, risk, input: req.input });
  if (answer === 'yes') return { allowed: true };
  if (answer === 'always') {
    policy.allow.add(req.name);
    return { allowed: true };
  }
  if (answer === 'all') {
    policy.mode = 'allow-all';
    return { allowed: true };
  }
  return { allowed: false, reason: 'you declined' };
}

/**
 * A `PreToolUse` hook that enforces a {@link PermissionPolicy} at the existing L1
 * HookBus seam — a thin wrapper over {@link checkPermission} for the build loop's
 * tool calls (the chat gates its tools with `checkPermission` directly).
 */
export function permissionHook(
  policy: PermissionPolicy,
  riskOf: (name: string) => ToolRisk,
  prompt: PermissionPrompt,
): Hook {
  return async (payload) => {
    const { name, input } = (payload ?? {}) as { name?: string; input?: unknown };
    if (!name) return; // not a tool payload — nothing to gate
    const { allowed, reason } = await checkPermission(policy, riskOf, prompt, { name, input });
    if (!allowed) return { block: true, reason: `tool "${name}" ${reason}` };
  };
}
