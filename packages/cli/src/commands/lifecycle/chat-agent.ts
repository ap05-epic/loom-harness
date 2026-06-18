import { AgentRunner, type ChatMessage, type LlmGateway, type ToolDef } from '@loom/agents';
import { MemoryStore, SkillStore, type SqliteDatabase } from '@loom/core';
import {
  checkPermission,
  type PermissionPolicy,
  type PermissionPrompt,
  type ToolRisk,
} from '@loom/tools';
import type { ChatTool } from './chat-tools.js';

/**
 * Recall the most relevant project facts + active skills for this turn and format them for the
 * system prompt — context packing, not a tool (the agent shouldn't have to ask). Per-turn + cheap;
 * injected as an ephemeral system message so the base prompt stays cache-stable.
 */
export function packRecall(db: SqliteDatabase, project: string, userText: string): string {
  const terms = userText
    .split(/\W+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3);
  if (terms.length === 0) return '';
  const facts = new MemoryStore(db).recall(project, { terms, kind: 'project_fact', limit: 6 });
  const skills = new SkillStore(db).recall(project, { terms, limit: 4 });
  if (!facts.length && !skills.length) return '';
  const parts = ['## Recalled project context (use if relevant)'];
  if (facts.length) parts.push(`Facts:\n${facts.map((m) => `- ${m.title}: ${m.body}`).join('\n')}`);
  if (skills.length)
    parts.push(`Skills:\n${skills.map((k) => `- ${k.name}: ${k.description}`).join('\n')}`);
  return parts.join('\n');
}

/** The agent's standing instructions — how to operate the harness for the user. */
export const CHAT_SYSTEM_PROMPT = [
  'You operate the Loom Harness for the user. Loom maps a legacy app, rebuilds its',
  'screens in modern code, and proves — with a deterministic evaluator — that each',
  'rebuild matches the original. You drive it through tools.',
  '',
  'You can: set up the project (show_profile, configure_project); check status; map',
  'the legacy source; run the rebuild pipeline; and work the human inbox (approve/',
  "reject gates, answer the agent's questions).",
  '',
  'You can also explore THIS codebase + your own capabilities to answer questions',
  'about how Loom works or where something lives:',
  '- search_code / read_file / list_files — read the repo (read-only; never write).',
  '- read_doc — read Loom’s own docs under docs/ (concepts, guides, decisions, reference).',
  '- list_tools / list_commands / list_skills — your own tools, the CLI commands, the skills.',
  '- run_command — run a shell command (curl, git, node, a build). This is the ONLY tool',
  '  that affects the machine; the user approves every run. Say what you will run and why',
  '  first, and prefer read-only commands. Everything else is read-only.',
  'When asked "how does X work" or "where is Y", SEARCH and READ rather than guessing,',
  'and cite file paths. If recalled project memory is provided, trust it.',
  '',
  'Guidelines:',
  '- Be concise and concrete. Prefer doing (calling a tool) over explaining.',
  '- If the project is not set up (a map/run or show_profile says the profile needs',
  '  source.strutsConfig or app.baseUrl), ask the user for the legacy source path and',
  '  the running app URL, then call configure_project — then offer to map and run.',
  '- configure_project also sets the explore/crawl fields (startPath, faEnv, hydrateMs,',
  '  cookiesPath) so `loom explore` can log itself in and walk the app — collect those',
  '  conversationally too rather than telling the user to hand-edit loom.config.yaml.',
  '- Say what you are about to do before an expensive action (map/run); the user is',
  '  asked to approve it.',
  '- After a run, ALWAYS report screens waiting for approval (ship gates) and any',
  '  blocked-screen questions, and offer to resolve them. When the user answers,',
  '  call answer_question / approve_gate, then run resume.',
  '- Loom only rebuilds the UI into a fresh repo; it never modifies the legacy source',
  '  or the backend. Reassure the user of this if they worry about it.',
  '- Never claim a screen is shipped unless an approved ship gate says so. The',
  '  deterministic evaluator — not you — decides whether a rebuild passes.',
  '- Use a tool when one fits the request rather than guessing the answer.',
].join('\n');

export type AgenticTurnOptions = {
  model: string;
  history: ChatMessage[];
  input: string;
  tools: ChatTool[];
  policy: PermissionPolicy;
  prompt: PermissionPrompt;
  /** Per-turn recalled project memory/skills (from {@link packRecall}) — injected as a system message. */
  recall?: string;
  /** Guard overrides (defaults are generous — the user is present and bounds the run). */
  guards?: { maxIterations?: number; maxTokens?: number; maxWallClockMs?: number };
  /** Fired as each tool starts/finishes, so the view can show live progress. */
  onTool?: (e: { name: string; phase: 'start' | 'done'; ok?: boolean; summary?: string }) => void;
};

/**
 * One agentic chat turn: wrap each tool's `execute` with the permission gate,
 * then run the existing {@link AgentRunner} loop (model ⇄ tools until it answers).
 * Returns the model's final text plus the updated transcript to carry forward.
 */
export async function agenticChatTurn(
  gateway: LlmGateway,
  opts: AgenticTurnOptions,
): Promise<{ history: ChatMessage[]; finalText: string | null }> {
  const riskOf = (name: string): ToolRisk =>
    opts.tools.find((t) => t.def.name === name)?.risk ?? 'expensive';

  const gated: ToolDef[] = opts.tools.map((t) => ({
    name: t.def.name,
    description: t.def.description,
    parameters: t.def.parameters,
    execute: async (args: unknown): Promise<string> => {
      const check = await checkPermission(opts.policy, riskOf, opts.prompt, {
        name: t.def.name,
        input: args,
      });
      if (!check.allowed)
        return `Not run — permission ${check.reason}. Ask the user before retrying.`;
      opts.onTool?.({ name: t.def.name, phase: 'start' });
      try {
        const result = await t.def.execute(args);
        opts.onTool?.({ name: t.def.name, phase: 'done', ok: true, summary: result });
        return result;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        opts.onTool?.({ name: t.def.name, phase: 'done', ok: false, summary: msg });
        throw error;
      }
    },
  }));

  const messages: ChatMessage[] = [
    ...opts.history,
    ...(opts.recall ? [{ role: 'system' as const, content: opts.recall }] : []),
    { role: 'user', content: opts.input },
  ];
  const result = await new AgentRunner(gateway).run({
    model: opts.model,
    messages,
    tools: gated,
    guards: {
      maxIterations: opts.guards?.maxIterations ?? 16,
      maxTokens: opts.guards?.maxTokens ?? 400_000,
      maxWallClockMs: opts.guards?.maxWallClockMs ?? 30 * 60_000,
    },
  });
  return { history: result.transcript, finalText: result.finalText };
}
