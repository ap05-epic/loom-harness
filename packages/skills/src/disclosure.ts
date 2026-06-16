import type { SkillDoc } from './skill-md.js';

/**
 * Level 0 — a cheap catalog (name + description, one line each) the context
 * packer scans first to decide which skills are relevant, without paying for any
 * bodies.
 */
export function skillCatalog(docs: SkillDoc[]): string {
  return docs.map((d) => `- ${d.name}: ${d.description}`).join('\n');
}

/**
 * Level 1 — the full skill (name, description, and the procedure body) for the
 * few skills the packer selects from the catalog.
 */
export function skillEntry(doc: SkillDoc): string {
  return `## ${doc.name}\n${doc.description}\n\n${doc.body}`;
}
