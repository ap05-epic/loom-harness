import { MemoryStore } from '@loom/core';
import { tool, type ChatSession, type ChatTool } from './session.js';

/**
 * The agent's long-term memory tools. `memory_recall` reads relevant remembered facts; the context
 * packer already injects recall automatically each turn (see {@link packRecall}), but this lets the
 * agent search deliberately. `memory_remember` persists a durable fact so it survives the
 * conversation.
 *
 * Today both operate on the project tier (the existing `memory_index`, scoped per project). Workstream
 * B layers conversation/profile tiers + a proactive nudge on top of these same tools.
 */
export function buildMemoryTools(session: ChatSession): ChatTool[] {
  const project = session.profile.project;
  return [
    tool(
      'memory_recall',
      'Recall durable facts remembered about this project, by keyword. Use when you need a ' +
        'convention/preference you (or a past session) noted earlier.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'keywords to search remembered facts' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      'read',
      async (a) => {
        const { query } = a as { query?: string };
        if (!query) return 'memory_recall needs a "query".';
        const terms = query.split(/\W+/).filter((w) => w.length >= 3);
        if (terms.length === 0) return '(give at least one 3+ letter keyword)';
        const projectFacts = new MemoryStore(session.db).recall(project, { terms, limit: 8 });
        const profileFacts = session.profileStore?.recall(terms, 4) ?? [];
        const lines = [
          ...profileFacts.map((m) => `- [profile] ${m.title}: ${m.body}`),
          ...projectFacts.map((m) => `- ${m.title}: ${m.body}`),
        ];
        return lines.length ? lines.join('\n') : '(nothing remembered yet matching that)';
      },
    ),
    tool(
      'memory_remember',
      'Remember a durable fact so it can be recalled in later turns and sessions. Keep it a single, ' +
        'specific, reusable fact. scope "project" (default) is this app; scope "profile" is a ' +
        'cross-cutting process/preference shared across every project on this profile.',
      {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'a short label, e.g. "Date format"' },
          body: { type: 'string', description: 'the fact, e.g. "all dates render dd.MM.yyyy"' },
          scope: {
            type: 'string',
            enum: ['project', 'profile'],
            description:
              'project (default) or profile (cross-project, durable across this profile)',
          },
        },
        required: ['title', 'body'],
        additionalProperties: false,
      },
      'safe',
      async (a) => {
        const { title, body, scope } = a as { title?: string; body?: string; scope?: string };
        if (!title || !body) return 'memory_remember needs a "title" and a "body".';
        if (scope === 'profile' && session.profileStore) {
          session.profileStore.remember({ title, body });
          return `Remembered (profile): ${title}.`;
        }
        new MemoryStore(session.db).remember({ project, kind: 'project_fact', title, body });
        return `Remembered: ${title}.`;
      },
    ),
  ];
}
