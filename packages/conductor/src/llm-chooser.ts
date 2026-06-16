import type { ChatMessage, LlmGateway } from '@loom/agents';
import type { Candidate, Chooser, ChooserContext } from '@loom/surveyor';

/**
 * The LLM-backed explorer chooser: given the interactive controls on the current screen and how
 * many screens have been discovered, the model picks the one most likely to reveal an unseen screen
 * — steered toward navigation and away from destructive actions (the crawl is read-only). The
 * `surveyor.explore` loop owns the budget + dedup; this only decides "click which control next".
 */

/** The navigation prompt — strict-JSON reply, read-only safety baked in. */
export function buildChoosePrompt(ctx: ChooserContext): ChatMessage[] {
  const list = ctx.candidates
    .map((c) => `- ${c.ref}: ${c.label || '(no label)'} [${c.kind}]`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        'You are the Explorer mapping a legacy app to discover every distinct screen. You receive ' +
        'the interactive controls on the CURRENT screen and how many screens are already found. ' +
        'Pick the ONE control most likely to reveal a screen NOT YET SEEN. Prefer navigation — ' +
        'menus, tabs, "view"/"detail"/"open"/"search" actions. NEVER pick a destructive or mutating ' +
        'action (delete, remove, save, submit, send, pay, confirm) — the crawl must not change data. ' +
        'Reply with STRICT JSON only: {"ref":"<ref>"} to click that control, or {"ref":null} to go ' +
        'back. No prose.',
    },
    {
      role: 'user',
      content: `Discovered so far: ${ctx.visitedKeys.size} screens.\nControls:\n${list}`,
    },
  ];
}

/**
 * Parse the model's reply into a candidate ref, or `null` to backtrack. Tolerates prose around the
 * JSON and **only** returns a ref the page actually offered (a hallucinated ref ⇒ backtrack), so a
 * sloppy or adversarial reply can never drive a click that isn't there.
 */
export function parseChoice(content: string | null, validRefs: string[]): string | null {
  if (!content) return null;
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const ref = (obj as Record<string, unknown>).ref;
  if (typeof ref !== 'string') return null; // null / missing ⇒ backtrack
  return validRefs.includes(ref) ? ref : null;
}

/** Build a `Chooser` that asks the model which control to click next. */
export function llmChooser(gateway: LlmGateway, model: string): Chooser {
  return async (ctx: ChooserContext): Promise<string | null> => {
    if (ctx.candidates.length === 0) return null;
    const res = await gateway.complete({ model, messages: buildChoosePrompt(ctx) });
    return parseChoice(
      res.content,
      ctx.candidates.map((c: Candidate) => c.ref),
    );
  };
}
