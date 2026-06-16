import type { Memory, MemoryStore, Skill, SkillStore } from '@loom/core';
import type { ChatMessage, LlmGateway } from '../types.js';
import { extractJsonObject } from './json.js';

export type ReflectInput = {
  project: string;
  /** The screen/key that just passed. */
  screen: string;
  /** What the work order covered and what actually worked (the conductor supplies this). */
  notes: string;
  model: string;
};

export type ReflectResult = { skills: Skill[]; facts: Memory[] };

export type ParsedReflection = {
  skills: Array<{ name: string; description: string; triggers: string[]; body: string }>;
  facts: Array<{ title: string; body: string }>;
};

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * Lenient parse of a Reflector reply into draft skills + facts. Tolerates prose around the
 * JSON and silently drops malformed entries (a skill with no name, a fact with no title) so
 * a sloppy model reply degrades to "nothing reusable" rather than throwing.
 */
export function parseReflection(content: string | null): ParsedReflection {
  const root = content ? extractJsonObject(content) : null;
  const obj = (root && typeof root === 'object' ? root : {}) as Record<string, unknown>;
  const rawSkills = Array.isArray(obj.skills) ? obj.skills : [];
  const rawFacts = Array.isArray(obj.facts) ? obj.facts : [];
  const skills = rawSkills
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      name: asString(s.name).trim(),
      description: asString(s.description).trim(),
      triggers: asStringArray(s.triggers),
      body: asString(s.body).trim(),
    }))
    .filter((s) => s.name.length > 0);
  const facts = rawFacts
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({ title: asString(f.title).trim(), body: asString(f.body).trim() }))
    .filter((f) => f.title.length > 0);
  return { skills, facts };
}

/** The extraction prompt — grounded on the real screen + outcome; strict-JSON, empty-if-nothing. */
export function buildReflectPrompt(input: { screen: string; notes: string }): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are the Reflector. A screen has been rebuilt and passed its parity eval. Extract only ' +
        'GENUINELY REUSABLE knowledge for future conversions of this same app:\n' +
        '- skills: reusable conversion procedures (e.g. "convert <logic:iterate> tables to a React table").\n' +
        '- facts: stable project conventions (e.g. "dates render dd.MM.yyyy").\n' +
        'Ground every item in what actually happened — invent nothing. If nothing is reusable, return ' +
        'empty arrays. Respond with STRICT JSON only, no prose:\n' +
        '{"skills":[{"name":"","description":"","triggers":[],"body":""}],"facts":[{"title":"","body":""}]}',
    },
    { role: 'user', content: `Screen: ${input.screen}\n\nWhat happened:\n${input.notes}` },
  ];
}

/**
 * The Reflector role: after a passed work package, ask the model for the reusable lessons and
 * persist them as **draft** skills (tier `generated`, awaiting human approval) and project-fact
 * memories. This is the generative half of the self-improvement loop — the packer's recall is
 * the consume half. The model's self-assessment is never trusted to ship: drafts are inert until
 * a human activates them.
 */
export async function reflect(
  gateway: LlmGateway,
  stores: { skills: SkillStore; memory: MemoryStore },
  input: ReflectInput,
): Promise<ReflectResult> {
  const res = await gateway.complete({
    model: input.model,
    messages: buildReflectPrompt({ screen: input.screen, notes: input.notes }),
  });
  const parsed = parseReflection(res.content);
  const skills = parsed.skills.map((s) =>
    stores.skills.addSkill({
      project: input.project,
      name: s.name,
      description: s.description,
      triggers: s.triggers,
      body: s.body,
      tier: 'generated',
      status: 'draft',
    }),
  );
  const facts = parsed.facts.map((f) =>
    stores.memory.remember({
      project: input.project,
      kind: 'project_fact',
      title: f.title,
      body: f.body,
      meta: { source: 'reflector', screen: input.screen },
    }),
  );
  return { skills, facts };
}
