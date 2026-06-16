import type { z } from 'zod';
import type { HookBus } from './hooks.js';

/** Thrown when a PreToolUse hook vetoes a tool call — distinct from input-validation or run errors. */
export class ToolBlockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ToolBlockedError';
  }
}

/** A tool's structured result. Tools return data; the agent loop / evaluator interpret it. */
export type ToolResult = Record<string, unknown>;

/**
 * A typed, schema-validated tool the agent loop can call. The Zod `input` schema
 * is validated before `run`, so a tool body never sees malformed arguments —
 * least-privilege and well-formedness by construction.
 */
export type Tool<I = unknown> = {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType<I>;
  run(input: I): Promise<ToolResult>;
};

/** Define a tool, fixing the input and `run` types together. */
export function defineTool<I>(spec: {
  name: string;
  description: string;
  input: z.ZodType<I>;
  run: (input: I) => Promise<ToolResult>;
}): Tool<I> {
  return spec;
}

/**
 * A registry of tools. `run` looks the tool up by name, validates input against
 * its schema, fires the lifecycle hooks around the call (PreToolUse — which can
 * veto — then PostToolUse / PostToolUseFailure), and returns the structured
 * result. With no `hooks` bus it's a plain validated dispatcher.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly hooks?: HookBus;

  constructor(tools: Tool[] = [], opts: { hooks?: HookBus } = {}) {
    for (const t of tools) this.tools.set(t.name, t as Tool);
    this.hooks = opts.hooks;
  }

  async run(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);

    const parsed = tool.input.safeParse(input);
    if (!parsed.success) {
      const why = parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');
      throw new Error(`invalid input for tool ${name}: ${why}`);
    }
    const args = parsed.data;

    if (this.hooks) {
      const pre = await this.hooks.emit('PreToolUse', { name, input: args });
      if (pre.blocked) {
        throw new ToolBlockedError(pre.reason ?? `tool ${name} blocked by a PreToolUse hook`);
      }
    }

    try {
      const result = await tool.run(args);
      if (this.hooks) await this.hooks.emit('PostToolUse', { name, input: args, result });
      return result;
    } catch (error) {
      if (this.hooks) await this.hooks.emit('PostToolUseFailure', { name, input: args, error });
      throw error;
    }
  }
}
