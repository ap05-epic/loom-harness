import type { NetworkRequest } from '@loom/browser';
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
  /** The legacy screen AS RENDERED (tags + computed styles) — the exact target the checker measures. */
  renderedTarget?: string;
  /** The legacy stylesheets are already linked into the app — reproduce markup + class names only. */
  reuseAssets?: boolean;
  /** The backend endpoints this screen pulls data from (redacted) — fetch live, never hardcode. */
  endpoints?: NetworkRequest[];
  /** From the runtime crawl: the real user-path links + each value's backing endpoint (provenance). */
  crawl?: {
    interactions?: Array<{ label: string; target: string; kind: string }>;
    provenance?: Array<{ value: string; endpointUrl: string; label?: string }>;
  };
  /** On a retry: the concrete differences the deterministic checker found. */
  diffs?: string;
};

/**
 * The builder's system prompt for React conversion. The model is a faithful re‑implementer: it
 * reproduces the legacy screen exactly in React and **only** fixes what the checker flags — it never
 * decides whether the result matches.
 */
export const REACT_SYSTEM_PROMPT =
  'You are a senior React engineer porting a legacy Struts/JSP screen to React with ZERO visual change. ' +
  'Your job is to REPRODUCE the legacy screen exactly — never improve, modernize, or tidy it up. ' +
  'Keep the legacy tags as they are (including <center>, <font>, and table-based layout); keep the exact ' +
  'fonts, sizes, colors, and spacing even when they look dated (e.g. a Times New Roman default, a blue bold ' +
  'label). If the legacy sets no font, you set none — do not impose Arial or any reset. ' +
  'When a screenshot of the target is attached, MATCH WHAT YOU SEE in it — its colors, layout, fonts, ' +
  'borders, and visual styling — by writing the CSS needed; a plain unstyled page of text is WRONG. ' +
  'Reproduce every ' +
  'control, form field (name/type/options), and navigation link / form action exactly (same href/action). ' +
  'The captured DOM/screenshot shows the LAYOUT, not the data: NEVER hardcode the numbers/text/rows you ' +
  'see — they belong to one test account. Fetch the live data from the SAME backend endpoint the screen ' +
  'uses (given in the work order; the app proxies it to the real backend) and render whatever comes back, ' +
  'so a different account shows its own data. ' +
  'Write files with the write_file tool (paths relative to the build root). A deterministic machine — not ' +
  'you — judges parity; when it reports differences, fix exactly those and nothing else. Finish with a ' +
  'one-line text summary.';

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
    `- Write the screen component at \`${componentPath}\` and export it. A \`export default\` is fine — the app entry mounts whatever you export (default or a named \`App\`), so do not worry about the import style.`,
    '- It mounts at the root route and must render IDENTICALLY to the legacy screen — same tags, same fonts, colors, sizes, spacing.',
    '- **REPRODUCE, do not modernize.** Keep legacy tags exactly (`<center>`, `<font>`, table-based layout); do NOT swap them for `<div>`/flexbox. Do NOT change fonts (if the legacy has no font set, leave it default/serif — never impose Arial or a CSS reset). Do NOT change colors/spacing. The goal is byte-for-byte visual sameness, not better code.',
    "- Reproduce every element, text, control, form field (name/type/options), and link/form action exactly — including each form's `action` target, so navigation goes to the same place.",
    input.reuseAssets
      ? "- **The legacy stylesheets are ALREADY linked into this app** (the real CSS/images are served at their original paths). So DON'T write your own CSS — instead reproduce the markup with the EXACT same `class` names, `id`s, and element structure as the legacy, and the real stylesheet will style it identically. Keep any inline `style=` attributes the legacy has."
      : '- Reuse the legacy CSS/inline styles verbatim where present; you may add `.css`/`.module.css` files only to match the legacy.',
    '',
  ];

  if (input.renderedTarget && input.renderedTarget.trim()) {
    lines.push(
      '## THE TARGET — the legacy screen exactly as the browser renders it',
      "This is the live page's real tags, text, and COMPUTED styles (the font/color/size/spacing the " +
        'browser actually applies). Reproduce THIS output exactly — it is the ground truth and is more ' +
        'authoritative than the JSP template below (the template is server-side code; this is its result).',
      '```html',
      input.renderedTarget.trim(),
      '```',
      '',
    );
  }

  if (input.endpoints && input.endpoints.length > 0) {
    lines.push(
      '## DATA SOURCE — fetch this live, NEVER hardcode',
      'The numbers/text/rows in the target above belong to ONE test account — they are DATA, not layout.',
      'Do NOT inline them. Fetch from the SAME backend endpoint(s) the legacy screen uses (same-origin —',
      'the dev/prod server proxies them to the real backend with the live session) and render whatever',
      'comes back, so a different account shows ITS data. The endpoints this screen called:',
      ...input.endpoints.slice(0, 20).map((e) => `- ${e.method} ${e.url}`),
      'JSON → consume it; HTML → request it and read the same fields the JSP binds. Treat every captured',
      'value as a placeholder to REPLACE with the live fetch.',
      '',
    );
  }

  if (input.crawl?.interactions && input.crawl.interactions.length > 0) {
    lines.push(
      '## USER PATHS — the real links/tabs this screen exposes (from the live crawl)',
      'These are the runtime navigations + tabs the live app actually shows (the static map misses ' +
        'data‑driven drill‑down links). Reproduce each as a link/control to the SAME target:',
      ...input.crawl.interactions
        .slice(0, 40)
        .map((i) => `- ${i.label || '(no text)'} → ${i.target} [${i.kind}]`),
      '',
    );
  }
  if (input.crawl?.provenance && input.crawl.provenance.length > 0) {
    lines.push(
      "## DATA PROVENANCE — each value's backing endpoint (fetch live, NEVER hardcode)",
      ...input.crawl.provenance
        .slice(0, 30)
        .map((p) => `- ${p.value}${p.label ? ` (${p.label})` : ''} ⇐ ${p.endpointUrl}`),
      'Fetch from these endpoints and render their data; the captured numbers are placeholders. Use the ' +
        '`query_crawl` + `read_file` tools to inspect the saved response bodies and find the exact fields.',
      '',
    );
  }

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
