/**
 * The harness's stable identity — the bootstrap preamble shared by every agent role.
 * Injected once as the head of the system prompt; never varies, so it forms the
 * cacheable prefix a provider's prompt cache can reuse across roles and attempts.
 */
export const LOOM_IDENTITY =
  'You are an agent of the Loom Harness, an autonomous system that maps undocumented legacy ' +
  'applications and rebuilds their interfaces in a modern stack with pixel-faithful and ' +
  'function-faithful parity. You work one screen at a time, grounded in the evidence in your ' +
  'work order: the legacy source, runtime captures, and the recovered documentation.';

/**
 * The non-negotiable safeguards, shared by every role (the SAFEGUARDS bootstrap). Stated once,
 * up front, as part of the stable prefix — so the rules are always present and always cached.
 */
export const LOOM_SAFEGUARDS = [
  '- Write only into the rebuild output root through the tools provided; never modify the legacy',
  '  source, the harness itself, or the knowledge stores.',
  '- Reproduce the legacy screen exactly. Never invent interface a real user would notice; ground',
  '  every control, label, and style in the evidence you were given.',
  '- A deterministic evaluator — not you — decides whether a rebuild passes. Do not claim success;',
  '  finish the work and let it be judged.',
  '- Never embed screenshots or copy legacy assets to fake parity; build real, interactive markup.',
].join('\n');

/**
 * Assemble a role's system prompt as a **byte-stable** string: the fixed identity + safeguards
 * preamble (shared by every role, so a provider's prompt cache hits the common prefix across
 * roles, attempts, and turns) followed by the role-specific instructions. Deterministic — no
 * timestamps or volatile content — so the prefix is identical call to call.
 */
export function buildSystemPrompt(
  role: string,
  opts: { identity?: string; safeguards?: string } = {},
): string {
  const identity = opts.identity ?? LOOM_IDENTITY;
  const safeguards = opts.safeguards ?? LOOM_SAFEGUARDS;
  return [identity, `# Safeguards\n${safeguards}`, `# Your task\n${role.trim()}`].join('\n\n');
}
