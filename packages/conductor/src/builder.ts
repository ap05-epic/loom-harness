import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  AgentRunner,
  buildSystemPrompt,
  runCopilotAgent,
  type ChatMessage,
  type ContentPart,
  type CopilotBin,
  type CopilotExec,
  type GuardConfig,
  type GuardKind,
  type LlmGateway,
  type ToolDef,
  type Usage,
} from '@loom/agents';
import {
  defineTool,
  HookBus,
  protectedPathsHook,
  ToolBlockedError,
  ToolRegistry,
} from '@loom/tools';
import { z } from 'zod';

/** A `write_file` tool bound to one output root, plus the list of paths it wrote. */
export type WriteFileTool = {
  tool: ToolDef;
  /** Relative paths written so far, in order — for observability and EVAL. */
  written: string[];
};

/**
 * Build the Builder's single filesystem tool. Writes are confined to `rootDir`
 * (the b-repo): a path that resolves outside it is refused with feedback the
 * model can act on, never thrown — this is the tool-layer half of protected
 * paths (agents may write only inside b-repo, never the legacy source, the
 * atlases, or the harness itself).
 */
export function createWriteFileTool(rootDir: string): WriteFileTool {
  const root = resolve(rootDir);
  const written: string[] = [];

  // The write itself is a typed @loom/tools tool, guarded by a PreToolUse hook
  // (the b-repo protected-paths guard) on a one-tool registry — so the path
  // policy is the shared, composable hook, not bespoke logic inside the tool.
  const writeFile = defineTool({
    name: 'write_file',
    description: 'Write a UTF-8 text file relative to the rebuild output root.',
    input: z.object({ path: z.string(), content: z.string() }),
    run: async ({ path, content }) => {
      const target = resolve(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
      const rel = target
        .slice(root.length + 1)
        .split(sep)
        .join('/');
      written.push(rel);
      return { wrote: rel, bytes: Buffer.byteLength(content, 'utf8') };
    },
  });
  const hooks = new HookBus().on('PreToolUse', protectedPathsHook(root));
  const registry = new ToolRegistry([writeFile], { hooks });

  // The model-facing ToolDef drives the registry, then translates the result
  // (or a protected-path veto / bad input) into feedback the model can act on.
  const tool: ToolDef = {
    name: 'write_file',
    description:
      'Write a UTF-8 text file into the rebuild output directory. "path" is relative to the ' +
      'output root (e.g. index.html or assets/app.css); writing outside the root is refused.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the output root.' },
        content: { type: 'string', description: 'Full file contents (UTF-8).' },
      },
      required: ['path', 'content'],
    },
    async execute(args: unknown): Promise<string> {
      try {
        const r = await registry.run('write_file', args);
        return `Wrote ${String(r.wrote)} (${String(r.bytes)} bytes).`;
      } catch (error) {
        if (error instanceof ToolBlockedError) {
          return `Refused: ${error.message}. Use a relative path inside the rebuild root.`;
        }
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
  return { tool, written };
}

/** Hard bounds for one build attempt; sensible defaults sized for a single screen. */
export const DEFAULT_BUILD_GUARDS: GuardConfig = {
  maxIterations: 24,
  maxTokens: 200_000,
  maxWallClockMs: 5 * 60_000,
  noProgressLimit: 3,
};

/** Cap a single tool result so a pathological output can't blow the build transcript (L5 hygiene). */
const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 20_000;

const DEFAULT_BUILDER_ROLE =
  'Act as a senior frontend engineer rebuilding the legacy screen described in the work order. ' +
  'Reproduce the exact layout, text, controls, and styling. Emit every file with the write_file ' +
  'tool (paths relative to the rebuild root). When the screen is complete, reply with a short ' +
  'plain-text summary and no further tool calls.';

// Wrap the builder's role in the shared identity + safeguards preamble so the system prompt is
// byte-stable and its cacheable prefix is reused across every screen and attempt (L5).
const DEFAULT_BUILDER_SYSTEM = buildSystemPrompt(DEFAULT_BUILDER_ROLE);

export type BuildScreenOptions = {
  gateway: LlmGateway;
  model: string;
  /** Output directory the write_file tool is confined to. */
  bRepoDir: string;
  /** The packed work order describing the screen to rebuild. */
  workOrder: string;
  /** Overrides merged onto DEFAULT_BUILD_GUARDS. */
  guards?: Partial<GuardConfig>;
  /** Override the builder system prompt. */
  systemPrompt?: string;
  /** Per-turn output cap passed to the gateway. */
  maxTokensPerTurn?: number;
  /** Cap each tool result at this many chars (default 20k); guards transcript hygiene. */
  maxToolOutputChars?: number;
  /** Images to attach to the work order (vision) — e.g. a screenshot of the target screen. */
  images?: Array<{ data: Buffer; caption?: string }>;
  now?: () => number;
};

export type BuildScreenResult = {
  status: 'completed' | 'guard_tripped';
  guard?: GuardKind;
  /** Relative paths written into the b-repo during this attempt. */
  filesWritten: string[];
  finalText: string | null;
  iterations: number;
  usage: Usage;
};

/**
 * One Builder attempt: run the agent loop with the `write_file` tool until the
 * model finishes (text, no tool call) or a guard trips. The model can only
 * touch `bRepoDir`; everything it produces is reported in `filesWritten`.
 */
export async function buildScreen(options: BuildScreenOptions): Promise<BuildScreenResult> {
  const { tool, written } = createWriteFileTool(options.bRepoDir);
  // Attach any images (a screenshot of the target) as a multimodal user message so a vision model can
  // SEE the screen, not just read its structure.
  const userContent: string | ContentPart[] = options.images?.length
    ? [
        { type: 'text', text: options.workOrder },
        ...options.images.flatMap((img): ContentPart[] =>
          img.caption
            ? [
                { type: 'text', text: img.caption },
                { type: 'image', data: img.data },
              ]
            : [{ type: 'image', data: img.data }],
        ),
      ]
    : options.workOrder;
  const messages: ChatMessage[] = [
    { role: 'system', content: options.systemPrompt ?? DEFAULT_BUILDER_SYSTEM },
    { role: 'user', content: userContent },
  ];
  const result = await new AgentRunner(options.gateway).run({
    model: options.model,
    messages,
    tools: [tool],
    guards: { ...DEFAULT_BUILD_GUARDS, ...options.guards },
    maxTokensPerTurn: options.maxTokensPerTurn,
    maxToolOutputChars: options.maxToolOutputChars ?? DEFAULT_MAX_TOOL_OUTPUT_CHARS,
    now: options.now,
  });
  return {
    status: result.status,
    guard: result.guard,
    filesWritten: written,
    finalText: result.finalText,
    iterations: result.iterations,
    usage: result.usage,
  };
}

/** A pluggable Builder: the AgentRunner+write_file path (default) or Copilot's agent. */
export type BuildStrategy = (args: {
  workOrder: string;
  bRepoDir: string;
  gateway: LlmGateway;
  model: string;
  guards?: Partial<GuardConfig>;
  now?: () => number;
}) => Promise<BuildScreenResult>;

/** The default strategy: our own agent loop with the protected `write_file` tool. */
export const defaultBuildStrategy: BuildStrategy = (args) => buildScreen(args);

function listFilesRecursive(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, root));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/**
 * Build a screen by delegating to the Copilot CLI's own agent — the path for a
 * GitHub Copilot login with no key, where we can't drive a tool loop through the
 * completion API. Copilot writes the files with its own tools, confined to the
 * b-repo via `-C`; the deterministic evaluator still gates the result, so its
 * self-assessment is never trusted.
 */
export async function copilotBuildScreen(opts: {
  workOrder: string;
  bRepoDir: string;
  model: string;
  bin?: CopilotBin;
  exec?: CopilotExec;
  timeoutMs?: number;
}): Promise<BuildScreenResult> {
  mkdirSync(opts.bRepoDir, { recursive: true });
  const prompt = [
    opts.workOrder,
    '',
    '# Output',
    'Write every file of the rebuild into the current working directory (and nowhere else).',
    'index.html must render at the server root.',
  ].join('\n');
  const res = await runCopilotAgent({
    prompt,
    cwd: opts.bRepoDir,
    model: opts.model,
    bin: opts.bin,
    exec: opts.exec,
    timeoutMs: opts.timeoutMs,
  });
  return {
    status: 'completed',
    filesWritten: listFilesRecursive(opts.bRepoDir),
    finalText: res.text,
    iterations: 1,
    usage: res.usage,
  };
}

/** A BuildStrategy that uses Copilot's agent (for `driver: copilot`, no key). */
export function copilotBuildStrategy(
  extra: { bin?: CopilotBin; exec?: CopilotExec; timeoutMs?: number } = {},
): BuildStrategy {
  return (args) =>
    copilotBuildScreen({
      workOrder: args.workOrder,
      bRepoDir: args.bRepoDir,
      model: args.model,
      bin: extra.bin,
      exec: extra.exec,
      timeoutMs: extra.timeoutMs,
    });
}
