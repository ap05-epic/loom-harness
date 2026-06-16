import { resolveModelProfile } from '@loom/agents';
import { networkError } from '../../errors.js';
import { describeProvider, gatewayFromProfile } from '../../pipeline-config.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';

type ModelRow = {
  role: string;
  model: string;
  driver: string;
  contextWindow: number;
  maxOutput: number;
  vision: boolean;
};

export const modelsListCommand = defineCommand({
  name: 'models list',
  group: 'lifecycle',
  describe: 'Show the active provider (Copilot login vs key) and configured models',
  exitCodes: ['CONFIG'],
  run(ctx) {
    const p = ctx.requireProfile();
    const prof = resolveModelProfile(p.llm.model, p.llm.modelProfile);
    const models: ModelRow[] = [
      {
        role: 'default',
        model: p.llm.model,
        driver: p.llm.driver,
        contextWindow: prof.contextWindow,
        maxOutput: prof.maxOutput,
        vision: prof.vision,
      },
    ];
    return { provider: describeProvider(p), models };
  },
  render(data, ctx) {
    const d = data as { provider: ReturnType<typeof describeProvider>; models: ModelRow[] };
    ctx.sink.line(`provider: ${d.provider.driver}`);
    ctx.sink.line(`auth:     ${d.provider.auth}`);
    ctx.sink.line(
      `model:    ${d.provider.model} ${d.provider.modelSelectable ? '(selectable — GitHub Copilot lets you choose)' : '(locked to this model by the key/endpoint)'}`,
    );
    ctx.sink.line('');
    const rows = d.models.map((r) => ({
      ...r,
      contextWindow: String(r.contextWindow),
      vision: r.vision ? 'yes' : 'no',
    }));
    ctx.sink.line(
      renderTable(rows, [
        { key: 'role', header: 'ROLE' },
        { key: 'model', header: 'MODEL' },
        { key: 'driver', header: 'DRIVER' },
        { key: 'contextWindow', header: 'CONTEXT', align: 'right' },
        { key: 'vision', header: 'VISION' },
      ]),
    );
  },
});

export const modelsTestCommand = defineCommand({
  name: 'models test',
  group: 'lifecycle',
  describe: 'Probe the LLM endpoint with a tiny completion',
  exitCodes: ['CONFIG', 'NETWORK'],
  options: [{ flags: '--model <id>', describe: 'override the model id to test' }],
  examples: ['loom models test', 'loom models test --model gpt-5.4'],
  async run(ctx, input) {
    const p = ctx.requireProfile();
    // Works for any driver — copilot (login, no key), openai, or anthropic.
    const gateway = gatewayFromProfile(p);
    const provider = describeProvider(p);
    const model = (input.options.model as string | undefined) ?? p.llm.model;
    const started = Date.now();
    try {
      const res = await gateway.complete({
        model,
        messages: [{ role: 'user', content: 'reply with one word: pong' }],
        maxTokens: 16,
      });
      return {
        ok: true,
        provider: provider.driver,
        auth: provider.auth,
        model,
        latencyMs: Date.now() - started,
        reply: (res.content ?? '').trim(),
        usage: res.usage,
      };
    } catch (error) {
      throw networkError(
        error instanceof Error ? error.message : String(error),
        p.llm.driver === 'copilot'
          ? 'run `copilot login` (or `dc login`) — the Copilot session may be missing or expired'
          : 'check the endpoint URL, API key, and that NO_PROXY covers the LLM host',
      );
    }
  },
  render(data, ctx) {
    const d = data as {
      provider: string;
      model: string;
      latencyMs: number;
      reply: string;
      usage: { inputTokens: number; outputTokens: number };
    };
    ctx.sink.line(
      `OK [${d.provider}] ${d.model} — "${d.reply}" in ${d.latencyMs}ms (${d.usage.inputTokens}+${d.usage.outputTokens} tokens)`,
    );
  },
});
