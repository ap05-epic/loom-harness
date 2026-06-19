import type { ChatMessage, LlmGateway, ToolDef, ToolSchema, Usage } from './types.js';

export type GuardConfig = {
  /** Maximum number of LLM calls in one run. */
  maxIterations: number;
  /** Cumulative input+output token budget. */
  maxTokens: number;
  /** Wall-clock cap for the whole run. */
  maxWallClockMs: number;
  /** Trip after this many identical consecutive model responses (default 3). */
  noProgressLimit?: number;
};

export type GuardKind = 'max_iterations' | 'token_budget' | 'wall_clock' | 'no_progress';

export type RunOptions = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  guards: GuardConfig;
  maxTokensPerTurn?: number;
  /** Cap each tool result at this many characters before it enters the transcript (hygiene). */
  maxToolOutputChars?: number;
  /**
   * Fired with each assistant message as it is produced — before its tool calls run — so a UI can
   * stream the turn (the gateway is non-streaming, so this is per-message, not per-token).
   */
  onStep?: (message: ChatMessage) => void;
  /** Injectable clock for tests. */
  now?: () => number;
};

/** Truncate an oversized tool result so one runaway output can't bloat the transcript. */
function capToolOutput(text: string, max: number | undefined): string {
  if (max === undefined || text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

export type RunResult = {
  status: 'completed' | 'guard_tripped';
  guard?: GuardKind;
  finalText: string | null;
  iterations: number;
  usage: Usage;
  transcript: ChatMessage[];
};

/**
 * The inner agent loop: model ⇄ tools until the model answers with text,
 * bounded by hard guards (iterations, tokens, wall clock, no-progress).
 * Tool failures are fed back to the model as tool results — never thrown.
 */
export class AgentRunner {
  constructor(private readonly gateway: LlmGateway) {}

  async run(options: RunOptions): Promise<RunResult> {
    const now = options.now ?? Date.now;
    const noProgressLimit = options.guards.noProgressLimit ?? 3;
    const tools = options.tools ?? [];
    const toolSchemas: ToolSchema[] = tools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
    const byName = new Map(tools.map((t) => [t.name, t]));

    const transcript: ChatMessage[] = [...options.messages];
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const startedAt = now();
    let iterations = 0;
    let lastResponseHash = '';
    let identicalStreak = 0;

    const tripped = (guard: GuardKind): RunResult => ({
      status: 'guard_tripped',
      guard,
      finalText: null,
      iterations,
      usage,
      transcript,
    });

    for (;;) {
      if (now() - startedAt > options.guards.maxWallClockMs) return tripped('wall_clock');
      if (iterations >= options.guards.maxIterations) return tripped('max_iterations');

      const response = await this.gateway.complete({
        model: options.model,
        messages: transcript,
        tools: toolSchemas.length ? toolSchemas : undefined,
        maxTokens: options.maxTokensPerTurn,
      });
      iterations += 1;
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;

      const assistant: ChatMessage = {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls.length ? response.toolCalls : undefined,
      };
      transcript.push(assistant);
      options.onStep?.(assistant);

      if (usage.inputTokens + usage.outputTokens > options.guards.maxTokens) {
        return tripped('token_budget');
      }

      // Hash semantic content only — tool-call ids are unique every turn, so
      // including them would make "identical" responses look like progress.
      const responseHash = JSON.stringify({
        c: response.content,
        t: response.toolCalls.map((tc) => ({ n: tc.name, a: tc.arguments })),
      });
      identicalStreak = responseHash === lastResponseHash ? identicalStreak + 1 : 1;
      lastResponseHash = responseHash;
      if (identicalStreak >= noProgressLimit) return tripped('no_progress');

      if (response.toolCalls.length === 0) {
        return {
          status: 'completed',
          finalText: response.content,
          iterations,
          usage,
          transcript,
        };
      }

      for (const call of response.toolCalls) {
        const tool = byName.get(call.name);
        let result: string;
        if (!tool) {
          result = `Unknown tool: ${call.name}. Available tools: ${[...byName.keys()].join(', ')}`;
        } else {
          // Parse the arguments on their own so a malformed tool call is repaired with a clear,
          // actionable message (and the tool never runs on garbage) — distinct from a tool failure.
          // The retry is bounded by the iteration / no-progress guards above.
          let args: unknown = {};
          let argsOk = true;
          if (call.arguments) {
            try {
              args = JSON.parse(call.arguments);
            } catch {
              argsOk = false;
            }
          }
          if (!argsOk) {
            result = `Invalid JSON arguments for ${call.name}: ${call.arguments.slice(0, 200)}. Resend the tool call with valid JSON.`;
          } else {
            try {
              result = await tool.execute(args);
            } catch (error) {
              result = `Error: ${error instanceof Error ? error.message : String(error)}`;
            }
          }
        }
        transcript.push({
          role: 'tool',
          toolCallId: call.id,
          content: capToolOutput(result, options.maxToolOutputChars),
        });
      }
    }
  }
}
