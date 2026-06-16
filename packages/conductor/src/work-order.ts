import { recallForWorkOrder } from '@loom/agents';
import type { CodeAtlas, Screen } from '@loom/cartographer';
import type { MemoryStore, SkillStore } from '@loom/core';

/** Resolve a JSP's raw legacy source by its logical path (e.g. `/jsp/login.jsp`). */
export type JspSource = (logicalPath: string) => string | undefined;

/** Stores + scope for recalling relevant skills + project memory into the order. */
export type WorkOrderRecall = {
  skills: SkillStore;
  memory: MemoryStore;
  project: string;
  /** When set, this WP's worklog ("what's been tried") is included. */
  wpId?: string;
};

export type WorkOrderInput = {
  /** Supplies the legacy JSP source for the screen's view JSPs. */
  jspSource?: JspSource;
  /** Whole-app repo-map for context (optional). */
  repoMap?: string;
  /** When set, recall the active skills + project memory relevant to this screen. */
  recall?: WorkOrderRecall;
};

/** The Builder's work order plus the bookkeeping the conductor needs after the build. */
export type WorkOrder = {
  /** The rendered prompt text the Builder receives. */
  text: string;
  /**
   * Ids of the active DB skills recalled into this order. The conductor records each as
   * "used" (with the WP's pass/fail) so the self-improvement loop can measure — and
   * eventually auto-promote — the skills that actually help.
   */
  recalledSkillIds: string[];
};

type ScreenSlice = ReturnType<CodeAtlas['sliceForScreen']>;

/** Search terms for recall: the screen key, its taglibs, and every form field name/tag. */
function recallTerms(screen: Screen, slice: ScreenSlice): string[] {
  const raw: string[] = [screen.key];
  if (slice) {
    raw.push(...slice.taglibs);
    for (const form of slice.forms) for (const f of form.fields) raw.push(f.property, f.tag);
  }
  const tokens = new Set<string>();
  for (const item of raw) {
    for (const tok of item.split(/[^a-zA-Z0-9:]+/)) {
      const v = tok.toLowerCase();
      if (v.length >= 3) tokens.add(v);
    }
  }
  return [...tokens];
}

/**
 * Build the Builder's work order from the enriched atlas: the recovered
 * documentation, the legacy facts, the parsed forms (fields + options), the
 * real JSP source to reproduce, and optional whole-app context. This is what
 * turns the cartographer's map into a build the model can actually do faithfully
 * — everything degrades gracefully when a piece isn't available.
 */
export function buildWorkOrder(
  atlas: CodeAtlas,
  screen: Screen,
  input: WorkOrderInput = {},
): WorkOrder {
  const slice = atlas.sliceForScreen(screen.key);
  const lines: string[] = [
    `# Work order — rebuild the "${screen.key}" screen with pixel-faithful and function-faithful parity`,
    '',
  ];

  const doc = slice ? atlas.getNodeDoc(slice.action.id) : null;
  if (doc) lines.push('## What this screen does (recovered)', doc, '');

  // Self-improvement: recall the active skills + project memory relevant to this screen,
  // placed high in the order (right after the doc) per the work-order shrink ladder.
  let recalledSkillIds: string[] = [];
  if (input.recall) {
    const { slots, skills } = recallForWorkOrder(
      { skills: input.recall.skills, memory: input.recall.memory },
      { project: input.recall.project, terms: recallTerms(screen, slice), wpId: input.recall.wpId },
    );
    recalledSkillIds = skills.map((s) => s.id);
    for (const s of slots) lines.push(`## ${s.name}`, s.content, '');
  }

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

  if (input.repoMap) lines.push('## App context (repo-map)', input.repoMap.trim(), '');

  lines.push(
    '## Instructions',
    'Produce a self-contained static rebuild (index.html plus any css/js) using the write_file tool,',
    'writing into the rebuild root. index.html must render at the server root. Reproduce the legacy',
    'layout, copy, controls, validation, and styling exactly. Finish with a short text summary.',
  );
  return { text: lines.join('\n'), recalledSkillIds };
}
