import type { CodeAtlas, Screen } from '@loom/cartographer';

/** Resolve a JSP's raw legacy source by its logical path (e.g. `/jsp/login.jsp`). */
export type JspSource = (logicalPath: string) => string | undefined;

export type ReactRecipeInput = {
  atlas: CodeAtlas;
  screen: Screen;
  /** Supplies the legacy JSP source for the screen's view JSPs. */
  jspSource?: JspSource;
  /** Where to write the screen component, relative to the build root (default `src/App.tsx`). */
  componentPath?: string;
  /** On a retry: the concrete differences the deterministic checker found. */
  diffs?: string;
};

/**
 * The builder's system prompt for React conversion. The model is a faithful re‑implementer: it
 * reproduces the legacy screen exactly in React and **only** fixes what the checker flags — it never
 * decides whether the result matches.
 */
export const REACT_SYSTEM_PROMPT =
  'You are a senior React engineer porting a legacy Struts/JSP screen to React, pixel- and ' +
  'function-faithful. Reproduce the legacy layout, copy, controls, form fields (name/type/options), ' +
  'styling, and navigation links EXACTLY. Reuse the legacy CSS/markup verbatim where you can (same ' +
  'class names, colors, fonts, spacing). Write files with the write_file tool (paths relative to the ' +
  'build root). A deterministic machine — not you — judges whether the result is a 1:1 match; when ' +
  'it reports differences, fix exactly those and nothing else. Finish with a one-line text summary.';

/**
 * Build the React work order for one screen from the atlas slice: legacy facts, every form field,
 * the real JSP source to reproduce, and — on a retry — the exact differences the checker found.
 * Degrades gracefully when a piece (doc, forms, source) isn't available.
 */
export function buildReactWorkOrder(input: ReactRecipeInput): string {
  const { atlas, screen } = input;
  const componentPath = input.componentPath ?? 'src/App.tsx';
  const slice = atlas.sliceForScreen(screen.key);
  const lines: string[] = [
    `# Work order — replicate the "${screen.key}" legacy screen as a React component, 1:1`,
    '',
    '## Target',
    `- Write the screen as the default-exported React component at \`${componentPath}\`.`,
    '- The app mounts that component at the root route, so it must render and behave identically to the legacy screen.',
    '- Reproduce every element, text, control, form field (name/type/options), and link (href) exactly.',
    '- Keep navigation paths identical: every legacy link/form action must appear as the same href/route in your markup.',
    '- Reuse the legacy CSS verbatim where possible; you may write extra `.css`/`.module.css` files and import them.',
    '',
  ];

  const doc = slice ? atlas.getNodeDoc(slice.action.id) : null;
  if (doc) lines.push('## What this screen does (recovered)', doc, '');

  lines.push('## Legacy facts', `- Action path: ${screen.actionPath}`);
  if (screen.actionType) lines.push(`- Struts action class: ${screen.actionType}`);
  if (screen.formBean) lines.push(`- Form bean: ${screen.formBean}`);
  if (slice?.taglibs.length) lines.push(`- Taglibs: ${slice.taglibs.join(', ')}`);
  lines.push('');

  if (slice?.forms.length) {
    lines.push('## Forms (reproduce every field, type, and option)');
    for (const form of slice.forms) {
      lines.push(`- ${form.action} [${form.method}]`);
      for (const field of form.fields) {
        const opts = field.options ? ` — options: [${field.options.join(', ')}]` : '';
        lines.push(`  - ${field.tag} "${field.property}"${opts}`);
      }
    }
    lines.push('');
  }

  const views = slice?.jsps ?? [];
  const sources = input.jspSource
    ? views
        .map((v) => ({ name: v.name, src: input.jspSource!(v.name) }))
        .filter((v): v is { name: string; src: string } => Boolean(v.src))
    : [];
  if (sources.length) {
    lines.push('## Legacy JSP source (reproduce this exactly)');
    for (const { name, src } of sources) lines.push(`### ${name}`, '```jsp', src.trim(), '```', '');
  }

  if (input.diffs && input.diffs.trim()) {
    lines.push(
      '## FIX THESE — the deterministic checker compared your last build to the original',
      'Fix EXACTLY these differences and nothing else; everything else already matches:',
      '',
      input.diffs.trim(),
      '',
    );
  }

  lines.push(
    '## Finish',
    'Write all needed files (the component + any CSS) with write_file, then reply with a one-line summary.',
  );
  return lines.join('\n');
}
