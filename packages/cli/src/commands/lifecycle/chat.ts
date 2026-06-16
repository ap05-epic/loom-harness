import { createInterface } from 'node:readline';
import type { ChatMessage, LlmGateway } from '@loom/agents';
import { describeProvider, gatewayFromProfile } from '../../pipeline-config.js';
import { defineCommand } from '../../registry.js';
import { readStdin } from './ask.js';

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
  describe: 'Start an interactive chat with the configured model (/exit to quit)',
  exitCodes: ['CONFIG', 'NETWORK'],
  options: [
    { flags: '--model <id>', describe: 'override the model id' },
    { flags: '--system <text>', describe: 'optional system instruction' },
  ],
  examples: ['loom chat', 'loom chat --model gpt-5.4'],
  async run(ctx, input) {
    const p = ctx.requireProfile();
    const gateway = gatewayFromProfile(p);
    const provider = describeProvider(p);
    const model = (input.options.model as string | undefined) ?? p.llm.model;
    const system = input.options.system as string | undefined;
    const baseHistory: ChatMessage[] = system ? [{ role: 'system', content: system }] : [];

    // Non-interactive (piped / --json / --no-input / CI): one prompt → one answer → exit.
    if (!ctx.mode.interactive) {
      const prompt = (await readStdin()).trim();
      if (!prompt) return { turns: 0, reply: null, model, provider: provider.driver };
      const { reply } = await chatTurn(gateway, { model, history: baseHistory, input: prompt });
      return { turns: 1, reply, model, provider: provider.driver };
    }

    // Interactive REPL — printed live, line by line.
    ctx.sink.line(`loom chat — ${provider.driver}:${model}. Type /exit to quit.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
    let history = baseHistory;
    let turns = 0;
    try {
      for (;;) {
        const text = (await ask('› ')).trim();
        if (text === '/exit' || text === '/quit') break;
        if (!text) continue;
        try {
          const r = await chatTurn(gateway, { model, history, input: text });
          history = r.history;
          turns++;
          ctx.sink.line(r.reply);
        } catch (error) {
          ctx.sink.error(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      rl.close();
    }
    return { turns, reply: null, model, provider: provider.driver };
  },
  render(data, ctx) {
    const d = data as { reply: string | null };
    // Non-interactive: print the single answer. Interactive already printed live.
    if (d.reply) ctx.sink.line(d.reply);
  },
});
