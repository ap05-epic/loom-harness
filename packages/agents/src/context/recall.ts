import type { Memory, MemoryStore, Skill, SkillStore } from '@loom/core';
import { rankSkillDocs, skillEntry, type SkillDoc } from '@loom/skills';
import type { Slot } from './packer.js';

export type RecallStores = { skills: SkillStore; memory: MemoryStore };

export type RecallInput = {
  project: string;
  /** Terms derived from the work order (screen name, form fields, taglibs…). */
  terms: string[];
  /** When set, this WP's worklog ("what's been tried") is included. */
  wpId?: string;
  /** Bundled file-based skills (loaded from disk) ranked + merged with the DB skills. */
  bundledSkills?: SkillDoc[];
  skillLimit?: number;
  factLimit?: number;
  /** Slot priorities in the work-order shrink ladder (lower = packed first). */
  skillPriority?: number;
  memoryPriority?: number;
};

export type RecalledContext = {
  skills: Skill[];
  /** Bundled file-skills selected for this work order (ranked; names already in the DB dropped). */
  bundled: SkillDoc[];
  facts: Memory[];
  worklog: Memory[];
  /** Ready-to-pack slots — only the non-empty ones are emitted. */
  slots: Slot[];
};

const formatSkill = (s: Skill): string =>
  [`### ${s.name}`, s.description.trim(), s.body.trim()].filter(Boolean).join('\n');

const formatFact = (m: Memory): string => `- **${m.title}**: ${m.body.trim()}`;

const formatWorklogEntry = (m: Memory): string => `- ${m.title}: ${m.body.trim()}`;

/**
 * The packer's recall step: pull the *active* skills and project memory relevant to a work
 * order (plus the current WP's worklog) and format them as work-order slots. Both slots use
 * the `truncate` shrink so, under budget pressure, the most-relevant entries (which the stores
 * return first) survive and the tail is cut. Empty slots are never emitted.
 */
export function recallForWorkOrder(stores: RecallStores, input: RecallInput): RecalledContext {
  const skills = stores.skills.recall(input.project, {
    terms: input.terms,
    limit: input.skillLimit ?? 6,
  });
  // Bundled file-skills, ranked the same way — minus any whose name a DB skill already covers.
  const dbNames = new Set(skills.map((s) => s.name));
  const bundled = (
    input.bundledSkills
      ? rankSkillDocs(input.bundledSkills, input.terms, input.skillLimit ?? 6)
      : []
  ).filter((d) => !dbNames.has(d.name));
  const facts = stores.memory.recall(input.project, {
    terms: input.terms,
    kind: 'project_fact',
    limit: input.factLimit ?? 6,
  });
  const worklog = input.wpId
    ? stores.memory.list(input.project, { kind: 'worklog', scopeId: input.wpId })
    : [];

  const slots: Slot[] = [];

  const skillEntries = [...skills.map(formatSkill), ...bundled.map(skillEntry)];
  if (skillEntries.length > 0) {
    slots.push({
      name: 'Relevant skills',
      content: skillEntries.join('\n\n'),
      priority: input.skillPriority ?? 30,
      shrink: 'truncate',
    });
  }

  if (facts.length > 0 || worklog.length > 0) {
    const sections: string[] = [];
    if (facts.length > 0) {
      sections.push(['**Project facts**', ...facts.map(formatFact)].join('\n'));
    }
    if (worklog.length > 0) {
      sections.push(
        [
          "**Worklog — what's been tried (don't repeat dead ends)**",
          ...worklog.map(formatWorklogEntry),
        ].join('\n'),
      );
    }
    slots.push({
      name: 'Project memory',
      content: sections.join('\n\n'),
      priority: input.memoryPriority ?? 35,
      shrink: 'truncate',
    });
  }

  return { skills, bundled, facts, worklog, slots };
}
