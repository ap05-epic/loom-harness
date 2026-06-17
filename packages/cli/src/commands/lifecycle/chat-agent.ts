import { AgentRunner, type ChatMessage, type LlmGateway, type ToolDef } from '@loom/agents';
import {
  checkPermission,
  type PermissionPolicy,
  type PermissionPrompt,
  type ToolRisk,
} from '@loom/tools';
import type { ChatTool } from './chat-tools.js';

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
  'Guidelines:',
  '- Be concise and concrete. Prefer doing (calling a tool) over explaining.',
  '- If the project is not set up (a map/run or show_profile says the profile needs',
  '  source.strutsConfig or app.baseUrl), ask the user for the legacy source path and',
  '  the running app URL, then call configure_project — then offer to map and run.',
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

  const messages: ChatMessage[] = [...opts.history, { role: 'user', content: opts.input }];
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
