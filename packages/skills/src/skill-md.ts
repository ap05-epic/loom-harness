import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** A parsed SKILL.md — agentskills.io-compatible frontmatter + the procedure body. */
export type SkillDoc = {
  name: string;
  description: string;
  triggers: string[];
  body: string;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse a `SKILL.md` (YAML frontmatter + markdown body) into a structured doc.
 * `name` + `description` are required; `triggers` is optional (used by the
 * context packer to rank a skill against a work order). The body is the
 * procedure the Builder/Fixer follows.
 */
export function parseSkillMd(content: string): SkillDoc {
  const m = FRONTMATTER.exec(content.replace(/^\s+/, ''));
  if (!m) throw new Error('SKILL.md is missing its `---` YAML frontmatter');
  const meta = (parseYaml(m[1]!) ?? {}) as Record<string, unknown>;
  const name = typeof meta.name === 'string' ? meta.name.trim() : '';
  const description = typeof meta.description === 'string' ? meta.description.trim() : '';
  if (!name) throw new Error('SKILL.md frontmatter needs a `name`');
  if (!description) throw new Error('SKILL.md frontmatter needs a `description`');
  const triggers = Array.isArray(meta.triggers) ? meta.triggers.map((t) => String(t)) : [];
  return { name, description, triggers, body: (m[2] ?? '').trim() };
}

/**
 * Serialize a {@link SkillDoc} back to SKILL.md text (YAML frontmatter + body) —
 * round-trips with {@link parseSkillMd}. The inverse used by the Reflector to
 * persist a drafted skill as a file.
 */
export function serializeSkillMd(doc: SkillDoc): string {
  const meta: Record<string, unknown> = { name: doc.name, description: doc.description };
  if (doc.triggers.length > 0) meta.triggers = doc.triggers;
  const front = stringifyYaml(meta).trimEnd();
  return `---\n${front}\n---\n\n${doc.body.trim()}\n`;
}
