import type { ChatMessage, LlmGateway } from '@loom/agents';
import type { Candidate, Chooser, ChooserContext, ExploreAction } from '@loom/surveyor';

/**
 * The LLM-backed explorer chooser: given the fillable fields + clickable controls on the current
 * screen (across all frames) and how many screens have been discovered, the model picks the next
 * ACTION — type into a field (login, FA Quick Search) or click a control — most likely to reveal an
 * unseen screen. Credentials/codes are referenced only by placeholder ($user/$pass/$fa); the real
 * values are substituted later in the driver and never enter this prompt. The `surveyor.explore`
 * loop owns the budget + dedup; this only decides "what to do next".
 */

/** The navigation prompt — strict-JSON reply, read-only safety baked in. */
export function buildChoosePrompt(ctx: ChooserContext, secretRefs: string[] = []): ChatMessage[] {
  const fillable = ctx.candidates.filter((c) => c.kind === 'textbox');
  const clickable = ctx.candidates.filter((c) => c.kind !== 'textbox');
  const fmt = (cs: Candidate[]): string =>
    cs.map((c) => `- ${c.ref}: ${c.label || '(no label)'} [${c.kind}]`).join('\n') || '(none)';
  const secrets = secretRefs.map((s) => `$${s}`).join(', ') || '(none)';
  const done =
    (ctx.taken ?? [])
      .map((a) => (a.kind === 'fill' ? `filled ${a.ref} (${a.value})` : `clicked ${a.ref}`))
      .join(', ') || '(nothing yet)';
  // Whole-session log, keyed by LABEL (refs differ per screen) — newest entries matter most, so keep
  // the last 40 to bound the prompt.
  const session =
    (ctx.history ?? [])
      .slice(-40)
      .map((h) =>
        h.action.kind === 'fill'
          ? `filled "${h.label || h.action.ref}"=${h.action.value}`
          : `clicked "${h.label || h.action.ref}"`,
      )
      .join('; ') || '(nothing yet)';
  return [
    {
      role: 'system',
      content:
        'You are the Explorer mapping a legacy menu-driven app to discover every distinct screen. ' +
        "You receive the CURRENT screen's fillable fields and clickable controls (across all frames), " +
        'how many screens are already found, and everything you have ALREADY done. Reply with STRICT ' +
        'JSON only, no prose:\n' +
        '  {"action":"fill","ref":"<ref>","value":"<text or $secret>"}  to type into a field, or\n' +
        '  {"action":"click","ref":"<ref>"}  to click a control, or\n' +
        '  {"action":null}  to go back.\n' +
        'Secret placeholders you may use as a fill value (the real value is substituted for you and ' +
        `is NEVER shown to you): ${secrets}. $user = login username, $pass = login password, ` +
        '$fa = the FA code for Quick Search.\n' +
        'Strategy: do the NEXT useful step. NEVER repeat anything listed under "Already done on THIS ' +
        'screen" or "Already done this session" — a filled field looks identical to an empty one, so ' +
        'trust those lists. On a LOGIN screen, fill $user and $pass then click submit/login. Entering ' +
        'the FA number is the GATEWAY to the data: when the page has an "FA Number" or Quick Search ' +
        'box, fill it with $fa and click Submit to load that advisor — do this whenever you reach a ' +
        'page that has an FA Number box whose data you have not loaded yet (an empty grid of column ' +
        'headers with no rows means the FA number still needs to be entered). Once the data loads, ' +
        'click the tabs/columns (e.g. NNM, Production, Pricing, QNR) to map each view; you need not ' +
        're-enter the FA number while moving among the tabs of a view you already loaded. If a search ' +
        'opened a list of RESULTS (a search overlay or a results table), CLICK the matching result to ' +
        'open it. ' +
        'Otherwise click a control you have NOT clicked yet that likely reveals a screen NOT yet seen ' +
        '(menus, tabs, "view"/"detail"/"open"); do not re-click a home/menu you already used or ' +
        're-open a screen already found. You MAY submit LOGIN and SEARCH forms to navigate. NEVER ' +
        'submit a form or click a control that creates, updates, deletes, saves, pays, sends, or ' +
        'confirms business data.',
    },
    {
      role: 'user',
      content:
        `Discovered so far: ${ctx.visitedKeys.size} screens.\n` +
        `Already done this session (do not repeat): ${session}.\n` +
        `Already done on THIS screen: ${done}.\n\n` +
        `Fillable fields:\n${fmt(fillable)}\n\nClickable controls:\n${fmt(clickable)}`,
    },
  ];
}

/**
 * Parse the model's reply into an {@link ExploreAction}, or `null` to backtrack. Tolerates prose
 * around the JSON and **only** returns an action whose `ref` the page actually offered (a
 * hallucinated ref ⇒ backtrack), so a sloppy or adversarial reply can never drive an action that
 * isn't there. A `$secret` fill value is passed through verbatim (it's resolved later, in the
 * driver) — it is deliberately NOT validated as a ref.
 */
export function parseChoice(content: string | null, validRefs: string[]): ExploreAction | null {
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
  const o = obj as Record<string, unknown>;
  if (o.action == null || o.ref == null) return null; // {"action":null} / missing ⇒ backtrack
  if (typeof o.ref !== 'string' || !validRefs.includes(o.ref)) return null; // hallucination defense
  if (o.action === 'fill') {
    return { kind: 'fill', ref: o.ref, value: typeof o.value === 'string' ? o.value : '' };
  }
  if (o.action === 'click' || o.action === 'submit') return { kind: 'click', ref: o.ref };
  return null;
}

/** Build a `Chooser` that asks the model which action to take next. */
export function llmChooser(gateway: LlmGateway, model: string, secretRefs: string[] = []): Chooser {
  return async (ctx: ChooserContext): Promise<ExploreAction | null> => {
    if (ctx.candidates.length === 0) return null;
    const res = await gateway.complete({ model, messages: buildChoosePrompt(ctx, secretRefs) });
    return parseChoice(
      res.content,
      ctx.candidates.map((c: Candidate) => c.ref),
    );
  };
}
