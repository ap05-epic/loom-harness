import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ChatMessage, LlmGateway } from '@loom/agents';
import { MIGRATIONS, openDb, runMigrations } from '@loom/core';
import { createPolicy, type PermissionMode, type PermissionPrompt } from '@loom/tools';
import { configError, usageError } from '../../errors.js';
import { describeProvider, gatewayFromProfile } from '../../pipeline-config.js';
import { defineCommand } from '../../registry.js';
import { makePalette } from '../../ui/colors.js';
import { ChatView } from '../../ui/chat-view.js';
import { agenticChatTurn, CHAT_SYSTEM_PROMPT } from './chat-agent.js';
import { buildChatTools, type ChatSession } from './chat-tools.js';
import { readStdin } from './ask.js';

const MODES: readonly PermissionMode[] = ['ask', 'auto', 'allow-all', 'deny'];

const HELP = [
  'commands: /exit · /help · /allow-all · /ask · /auto · /deny · /allow <tool>',
  'modes — ask: confirm each action · auto: auto-allow safe ones · allow-all: never ask · deny: block all',
].join('\n');

export type ChatTurnOptions = {
  model: string;
  history: ChatMessage[];
  input: string;
  maxTokens?: number;
};

/**
 * One conversational turn — append the user message, send the full running
 * history, append the assistant reply. Pure over an injected gateway and never
 * mutates the caller's history, so the REPL stays a thin shell around this.
 */
export async function chatTurn(
  gateway: LlmGateway,
  opts: ChatTurnOptions,
): Promise<{ history: ChatMessage[]; reply: string }> {
  const messages: ChatMessage[] = [...opts.history, { role: 'user', content: opts.input }];
  const res = await gateway.complete({
    model: opts.model,
    messages,
    maxTokens: opts.maxTokens ?? 1024,
  });
  const reply = (res.content ?? '').trim();
  return { history: [...messages, { role: 'assistant', content: reply }], reply };
}

export const chatCommand = defineCommand({
  name: 'chat',
  group: 'lifecycle',
  describe: 'Chat with the harness — it can map/run the pipeline and work the inbox for you',
  exitCodes: ['CONFIG', 'NETWORK', 'USAGE'],
  options: [
    { flags: '--model <id>', describe: 'override the model id' },
    { flags: '--system <text>', describe: 'extra system instruction' },
    { flags: '--permission-mode <mode>', describe: 'ask | auto | allow-all | deny (default: ask)' },
    { flags: '--allow-all', describe: 'run every tool without asking (autonomous)' },
    { flags: '--yolo', describe: 'alias for --allow-all' },
  ],
  examples: ['loom chat', 'loom chat --allow-all'],
  async run(ctx, input) {
    const p = ctx.requireProfile();
    const gateway = gatewayFromProfile(p);
    const provider = describeProvider(p);
    const model = (input.options.model as string | undefined) ?? p.llm.model;

    // Permission policy from flags.
    let mode: PermissionMode = 'ask';
    const flagMode = input.options.permissionMode as string | undefined;
    if (flagMode) {
      if (!MODES.includes(flagMode as PermissionMode)) {
        throw usageError(
          `unknown permission mode "${flagMode}"`,
          `choose one of: ${MODES.join(', ')}`,
        );
      }
      mode = flagMode as PermissionMode;
    }
    if (input.options.allowAll || input.options.yolo) mode = 'allow-all';
    const policy = createPolicy(mode);

    // Open the project db the tools read/write (status, gates, questions, runs).
    const dataDir = p.dataDir;
    if (!dataDir) {
      throw configError(
        'loom chat needs a project data dir',
        'run `loom init` first, or pass --data-dir <dir>',
      );
    }
    mkdirSync(dataDir, { recursive: true });
    const loomDb = join(dataDir, 'loom.db');
    const legacy = join(dataDir, 'harness.db');
    const db = openDb(!existsSync(loomDb) && existsSync(legacy) ? legacy : loomDb);
    runMigrations(db, MIGRATIONS);

    const session: ChatSession = { db, gateway, profile: p, version: ctx.version };
    const tools = buildChatTools(session);
    const extra = input.options.system as string | undefined;
    const system = extra ? `${CHAT_SYSTEM_PROMPT}\n\n${extra}` : CHAT_SYSTEM_PROMPT;
    const baseHistory: ChatMessage[] = [{ role: 'system', content: system }];

    try {
      // Non-interactive (piped / --json / CI): one prompt; expensive tools are denied unless --allow-all.
      if (!ctx.mode.interactive) {
        const prompt = (await readStdin()).trim();
        if (!prompt) return { turns: 0, reply: null, model, provider: provider.driver };
        const { finalText } = await agenticChatTurn(gateway, {
          model,
          history: baseHistory,
          input: prompt,
          tools,
          policy,
          prompt: () => 'no',
        });
        return { turns: 1, reply: finalText, model, provider: provider.driver };
      }

      // Interactive REPL with a polished chat view (banner, spinner, live tool lines).
      const view = new ChatView(makePalette(ctx.mode.color), (s) => process.stdout.write(s), {
        unicode: ctx.mode.color,
        tty: ctx.mode.spinner,
      });
      view.banner({ provider: provider.driver, model, mode: policy.mode });
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
      const prompt: PermissionPrompt = async (req) => {
        view.stop(); // pause the spinner so the approval line renders clean
        const a = (await ask(view.approvalText(req.name, req.risk))).trim().toLowerCase();
        view.thinking();
        if (a === 'y' || a === 'yes') return 'yes';
        if (a === 'a' || a === 'always') return 'always';
        if (a === '!' || a === 'all') return 'all';
        return 'no';
      };

      let history = baseHistory;
      let turns = 0;
      try {
        for (;;) {
          const text = (await ask(view.promptText())).trim();
          if (text === '/exit' || text === '/quit') break;
          if (!text) continue;
          if (text === '/help') {
            view.note(HELP);
            continue;
          }
          if (text === '/allow-all' || text === '/ask' || text === '/auto' || text === '/deny') {
            policy.mode = text.slice(1) as PermissionMode;
            view.note(`permission: ${policy.mode}`);
            continue;
          }
          if (text.startsWith('/allow ')) {
            const t = text.slice('/allow '.length).trim();
            if (t) {
              policy.allow.add(t);
              view.note(`always allowing: ${t}`);
            }
            continue;
          }
          view.thinking();
          try {
            const r = await agenticChatTurn(gateway, {
              model,
              history,
              input: text,
              tools,
              policy,
              prompt,
              onTool: (e) =>
                e.phase === 'start'
                  ? view.toolStart(e.name)
                  : view.toolDone(e.name, e.summary ?? '', e.ok ?? true),
            });
            history = r.history;
            turns += 1;
            view.assistant(r.finalText ?? '(no reply)');
          } catch (error) {
            view.error(error instanceof Error ? error.message : String(error));
          }
        }
      } finally {
        view.stop();
        rl.close();
      }
      return { turns, reply: null, model, provider: provider.driver };
    } finally {
      db.close();
    }
  },
  render(data, ctx) {
    const d = data as { reply: string | null };
    // Non-interactive: print the single answer. Interactive already printed live.
    if (d.reply) ctx.sink.line(d.reply);
  },
});
