import type { LlmGateway } from '@loom/agents';
import type { CodeAtlas, Screen } from './codeatlas.js';

const SUMMARY_SYSTEM =
  'You are documenting an undocumented legacy web screen for engineers who will rebuild it. ' +
  'Write a precise 2–4 sentence description: what the screen is for, the inputs it collects, and ' +
  'where it navigates. No preamble and no markdown headers — just the description.';

/**
 * Build the grounding facts for one screen from its atlas slice — the action, form bean, view
 * JSPs, forms, and navigation. Used both to *generate* a screen's doc (the summarizer) and to
 * *verify* it (the consensus panel checks the doc against exactly these facts).
 */
export function screenEvidence(atlas: CodeAtlas, screen: Screen): string {
  const slice = atlas.sliceForScreen(screen.key);
  const forms = (slice?.forms ?? [])
    .map(
      (f) =>
        `${f.action} [${f.method}] fields: ${f.fields.map((x) => x.property).join(', ') || 'none'}`,
    )
    .join('; ');
  const nav = new Set<string>();
  for (const jsp of slice?.jsps ?? []) {
    for (const target of atlas.linked(jsp.id, 'links_to')) nav.add(target.name);
  }
  return [
    `Screen: ${screen.key}`,
    `Struts action: ${screen.actionPath}${screen.actionType ? ` (${screen.actionType})` : ''}`,
    screen.formBean ? `Form bean: ${screen.formBean}` : '',
    `View JSPs: ${screen.viewJsps.join(', ') || 'none'}`,
    forms ? `Forms: ${forms}` : '',
    nav.size ? `Navigates to: ${[...nav].sort().join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export type SummarizeOptions = {
  gateway: LlmGateway;
  model: string;
  /** Output cap per screen doc (default 256). */
  maxTokensPerDoc?: number;
};

export type SummarizeResult = {
  screensSummarized: number;
  inputTokens: number;
  outputTokens: number;
};

/**
 * The summarization docs pass: for every screen, ask the model for a short
 * description grounded in the atlas slice and store it on the action node. This
 * is how MAP recovers the missing documentation — the generated docs are
 * human-reviewable, searchable, and feed later context packing. One completion
 * per screen (no tools); use a cheap model (the Summarizer role).
 */
export async function summarizeScreens(
  atlas: CodeAtlas,
  opts: SummarizeOptions,
): Promise<SummarizeResult> {
  let screensSummarized = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const screen of atlas.screens()) {
    const slice = atlas.sliceForScreen(screen.key);
    if (!slice) continue;
    const res = await opts.gateway.complete({
      model: opts.model,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM },
        { role: 'user', content: screenEvidence(atlas, screen) },
      ],
      maxTokens: opts.maxTokensPerDoc ?? 256,
    });
    inputTokens += res.usage.inputTokens;
    outputTokens += res.usage.outputTokens;
    const doc = (res.content ?? '').trim();
    if (doc) {
      atlas.setNodeDoc(slice.action.id, doc);
      screensSummarized++;
    }
  }

  return { screensSummarized, inputTokens, outputTokens };
}
