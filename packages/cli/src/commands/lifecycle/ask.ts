import type { ChatMessage, LlmGateway } from '@loom/agents';
import { networkError, usageError } from '../../errors.js';
import { describeProvider, gatewayFromProfile } from '../../pipeline-config.js';
import { defineCommand } from '../../registry.js';

export type AskOnceOptions = {
  model: string;
  prompt: string;
  system?: string;
  maxTokens?: number;
};

/**
 * One-shot completion — the testable core of `loom ask` (and the non-interactive
 * `loom chat` path). Pure over an injected gateway, so it's unit-tested with a
 * fake `complete` and never touches the network.
 */
export async function askOnce(
  gateway: LlmGateway,
  opts: AskOnceOptions,
): Promise<{ answer: string; usage: { inputTokens: number; outputTokens: number } }> {
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.prompt });
  const res = await gateway.complete({ model: opts.model, messages, maxTokens: opts.maxTokens });
  return { answer: (res.content ?? '').trim(), usage: res.usage };
}

/** Read piped stdin to end (empty string on a TTY — nothing was piped). */
export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (c) => (data += c));
    stdin.on('end', () => resolve(data));
    stdin.on('error', () => resolve(data));
  });
}

const NETWORK_HINT = (driver: string): string =>
  driver === 'copilot'
    ? 'run `copilot login` (or `dc login`) — the Copilot session may be missing or expired'
    : 'check LLM_BASE_URL (…/openai/v1) + LLM_API_KEY, and that NO_PROXY covers the LLM host';

export const askCommand = defineCommand({
  name: 'ask',
  group: 'lifecycle',
  describe: 'Ask the configured model a one-off question (prompt arg or piped stdin)',
  exitCodes: ['CONFIG', 'NETWORK', 'USAGE'],
  args: [{ name: 'prompt', describe: 'the prompt (omit to read from stdin)' }],
  options: [
    { flags: '--model <id>', describe: 'override the model id for this call' },
    { flags: '--system <text>', describe: 'optional system instruction' },
    { flags: '--max-tokens <n>', describe: 'max output tokens (default 1024)' },
  ],
  examples: ['loom ask "what does struts-config.xml define?"', 'loom ask --json "say pong"'],
  async run(ctx, input) {
    const argPrompt = (input.args.prompt as string | undefined)?.trim();
    const prompt = argPrompt || (await readStdin()).trim();
    if (!prompt) {
      throw usageError('no prompt given', 'pass a prompt argument or pipe text on stdin');
    }
    const p = ctx.requireProfile();
    const gateway = gatewayFromProfile(p);
    const provider = describeProvider(p);
    const model = (input.options.model as string | undefined) ?? p.llm.model;
    const maxTokens =
      input.options.maxTokens !== undefined ? Number(input.options.maxTokens) : 1024;
    try {
      const { answer, usage } = await askOnce(gateway, {
        model,
        prompt,
        system: input.options.system as string | undefined,
        maxTokens,
      });
      return { answer, model, provider: provider.driver, usage };
    } catch (error) {
      throw networkError(
        error instanceof Error ? error.message : String(error),
        NETWORK_HINT(p.llm.driver),
      );
    }
  },
  render(data, ctx) {
    ctx.sink.line((data as { answer: string }).answer);
  },
});
