import { OpenAiDriver, resolveModelProfile } from '@harness/agents';
import { configError, networkError } from '../../errors.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';

export const modelsListCommand = defineCommand({
  name: 'models list',
  group: 'lifecycle',
  describe: 'List configured models and their resolved capabilities',
  exitCodes: ['CONFIG'],
  run(ctx) {
    const p = ctx.requireProfile();
    const prof = resolveModelProfile(p.llm.model, p.llm.modelProfile);
    return [
      {
        role: 'default',
        model: p.llm.model,
        driver: p.llm.driver,
        contextWindow: prof.contextWindow,
        maxOutput: prof.maxOutput,
        vision: prof.vision,
      },
    ];
  },
  render(data, ctx) {
    const rows = (data as Array<Record<string, unknown>>).map((r) => ({
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
  examples: ['harness models test', 'harness models test --model gpt-5.4'],
  async run(ctx, input) {
    const p = ctx.requireProfile();
    const base = p.llm.baseUrlEnv ? p.env[p.llm.baseUrlEnv] : undefined;
    const key = p.llm.apiKeyEnv ? p.env[p.llm.apiKeyEnv] : undefined;
    if (!base || !key) {
      throw configError(
        'LLM base URL or API key not set in the environment',
        `set ${p.llm.baseUrlEnv ?? 'LLM_BASE_URL'} and ${p.llm.apiKeyEnv ?? 'LLM_API_KEY'} in your .env`,
      );
    }
    const model = (input.options.model as string | undefined) ?? p.llm.model;
    const driver = new OpenAiDriver({ baseUrl: base, apiKey: key });
    const started = Date.now();
    try {
      const res = await driver.complete({
        model,
        messages: [{ role: 'user', content: 'reply with one word: pong' }],
        maxTokens: 16,
      });
      return {
        ok: true,
        model,
        latencyMs: Date.now() - started,
        reply: (res.content ?? '').trim(),
        usage: res.usage,
      };
    } catch (error) {
      throw networkError(
        error instanceof Error ? error.message : String(error),
        'check the endpoint URL, API key, and that NO_PROXY covers the LLM host',
      );
    }
  },
  render(data, ctx) {
    const d = data as {
      model: string;
      latencyMs: number;
      reply: string;
      usage: { inputTokens: number; outputTokens: number };
    };
    ctx.sink.line(
      `OK ${d.model} — "${d.reply}" in ${d.latencyMs}ms (${d.usage.inputTokens}+${d.usage.outputTokens} tokens)`,
    );
  },
});
