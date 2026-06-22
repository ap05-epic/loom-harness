import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { textOf } from '../types.js';
import type { ChatMessage, LlmGateway, LlmRequest, LlmResponse, ToolSchema } from '../types.js';

export type CopilotExecResult = { stdout: string; stderr: string; exitCode: number };
export type CopilotExec = (
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; input?: string },
) => Promise<CopilotExecResult>;

/** The copilot command — a string ("copilot") or argv prefix (["node", "stub.js"] in tests). */
export type CopilotBin = string | string[];

export type CopilotDriverOptions = {
  /** Path/command for the copilot CLI (default "copilot" on PATH). */
  bin?: CopilotBin;
  /** Model to request; falls back to the request model, then the CLI's configured model. */
  model?: string;
  cwd?: string;
  /** Spawn override (injected in tests so no real binary/login is needed). */
  exec?: CopilotExec;
  timeoutMs?: number;
};

/** Spawn the copilot CLI, collecting stdout/stderr/exit code (the default exec). */
function defaultExec(bin: CopilotBin): CopilotExec {
  const argv = Array.isArray(bin) ? bin : [bin];
  const cmd = argv[0]!;
  const prefix = argv.slice(1);
  // On Windows the npm-global `copilot` is a `.cmd` shim that won't run through
  // spawn without a shell; an explicit argv (e.g. [node, stub] in tests) is
  // spawned directly. The pod is Linux, so the no-shell path is what ships there.
  const shell = process.platform === 'win32' && !Array.isArray(bin);
  return (args, opts) =>
    new Promise<CopilotExecResult>((resolve) => {
      const child = spawn(cmd, [...prefix, ...args], { cwd: opts.cwd, shell });
      let stdout = '';
      let stderr = '';
      const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : undefined;
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', (e) => {
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr: `${stderr}${String(e)}`, exitCode: 127 });
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });
      // Feed the prompt via stdin — the CLI reads it there, which sidesteps
      // cross-platform arg-quoting (a multi-word `-p` prompt breaks the Windows
      // shell shim). Always end stdin so the CLI doesn't wait for more input.
      child.stdin?.on('error', () => {
        // ignore EPIPE if the child exits before reading the prompt
      });
      child.stdin?.end(opts.input ?? '');
    });
}

/** Flatten the provider-agnostic chat into a single prompt for `copilot -p`. */
export function renderCopilotPrompt(messages: ChatMessage[], tools?: ToolSchema[]): string {
  const parts: string[] = [];
  if (tools?.length) {
    parts.push(
      `# Available tools\n${tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')}`,
    );
  }
  for (const m of messages) {
    if (m.role === 'system') parts.push(`# Instructions\n${textOf(m.content)}`);
    else if (m.role === 'user') parts.push(textOf(m.content));
    else if (m.role === 'assistant') {
      if (m.content) parts.push(`# Assistant\n${m.content}`);
      for (const tc of m.toolCalls ?? []) parts.push(`# Tool call: ${tc.name}(${tc.arguments})`);
    } else if (m.role === 'tool') parts.push(`# Tool result\n${m.content}`);
  }
  return parts.join('\n\n');
}

const TEXT_FIELDS = ['text', 'response', 'content', 'message', 'result', 'output', 'reply'];

function pickText(obj: Record<string, unknown>): string | null {
  for (const f of TEXT_FIELDS) {
    const v = obj[f];
    if (typeof v === 'string') return v;
  }
  const msg = obj.message as Record<string, unknown> | undefined;
  if (msg && typeof msg.content === 'string') return msg.content;
  return null;
}

function pickUsage(obj: Record<string, unknown>): { inputTokens: number; outputTokens: number } {
  const u = (obj.usage ?? {}) as Record<string, unknown>;
  const num = (...keys: string[]): number => {
    for (const k of keys) {
      const v = u[k];
      if (typeof v === 'number') return v;
    }
    return 0;
  };
  return {
    inputTokens: num('input_tokens', 'prompt_tokens', 'inputTokens'),
    outputTokens: num('output_tokens', 'completion_tokens', 'outputTokens'),
  };
}

/**
 * Parse `copilot ... --output-format json` stdout into the provider-agnostic
 * response. Lenient — handles a single JSON object, JSONL (takes the final
 * result line), and a plain-text fallback — because the CLI's exact schema is
 * verified against the live binary on the pod. Tool calls aren't surfaced here:
 * the Builder uses Copilot's own agentic tools (see the build path), while text
 * agents (Summarizer/Planner/Doc-writer) need only the completion.
 */
export function parseCopilotResponse(stdout: string): LlmResponse {
  const trimmed = stdout.trim();
  const events = trimmed
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line): Record<string, unknown> | null => {
      try {
        const v: unknown = JSON.parse(line);
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
      } catch {
        return null; // progress noise / non-JSON line
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);

  // The real GitHub Copilot CLI `--output-format json` is a JSONL event stream:
  // the answer + token count ride on `assistant.message` events (verified against
  // CLI 1.0.63). Prefer that; the final assistant turn is the response.
  const assistantMsgs = events.filter((e) => e.type === 'assistant.message');
  if (assistantMsgs.length > 0) {
    const data = (assistantMsgs[assistantMsgs.length - 1]!.data ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
    return {
      content: typeof data.content === 'string' ? data.content : null,
      toolCalls: [],
      usage: { inputTokens: num(data.inputTokens), outputTokens: num(data.outputTokens) },
      finishReason: 'stop',
    };
  }

  // Fallbacks for other tools/versions: a single JSON object, a JSONL line with a
  // text field, or plain text.
  let obj: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(trimmed);
    if (v && typeof v === 'object') obj = v as Record<string, unknown>;
  } catch {
    // not a single JSON document
  }
  if (!obj) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (pickText(events[i]!) !== null) {
        obj = events[i]!;
        break;
      }
    }
  }
  if (!obj) {
    return {
      content: trimmed || null,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: 'stop',
    };
  }
  return {
    content: pickText(obj),
    toolCalls: [],
    usage: pickUsage(obj),
    finishReason: typeof obj.finish_reason === 'string' ? obj.finish_reason : 'stop',
  };
}

const AUTH_PATTERNS =
  /not logged in|unauthenticated|authentication|session (?:has )?expired|login required|please (?:run )?[`']?(?:copilot |dc )?login|gh auth|sign in|token (?:has )?expired/i;

/** Turn a CLI failure into a clear message — re-auth hint when the session lapsed. */
export function classifyCopilotError(stderr: string, exitCode: number): string {
  const trimmed = stderr.trim();
  if (AUTH_PATTERNS.test(stderr)) {
    return 'GitHub Copilot is not authenticated (session missing or expired). Run `copilot login` (or `dc login`) and retry.';
  }
  // A failed copilot call that printed nothing is, in practice, almost always a
  // lapsed login (the pod hit "exit 1: no error output"). Point at re-auth too.
  if (exitCode !== 0 && trimmed === '') {
    return `GitHub Copilot CLI exited (code ${exitCode}) with no output — the login session is likely missing or expired. Run \`copilot login\` (or \`dc login\`) and retry.`;
  }
  return `copilot CLI failed (exit ${exitCode}): ${trimmed || 'no error output'}`;
}

/**
 * LlmGateway driver backed by the authenticated GitHub Copilot CLI — the path
 * for the many developers who have a Copilot LOGIN but no direct endpoint key.
 * Needs no LLM_BASE_URL / LLM_API_KEY: auth comes from the user's `copilot`
 * session. Model selection is honored (Copilot lets you choose the model).
 */
export class CopilotDriver implements LlmGateway {
  private readonly exec: CopilotExec;
  constructor(private readonly options: CopilotDriverOptions = {}) {
    this.exec = options.exec ?? defaultExec(options.bin ?? 'copilot');
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const prompt = renderCopilotPrompt(request.messages, request.tools);
    const args = ['--output-format', 'json'];
    const model = this.options.model ?? request.model;
    if (model) args.push('--model', model);
    const { stdout, stderr, exitCode } = await this.exec(args, {
      cwd: this.options.cwd,
      timeoutMs: this.options.timeoutMs ?? 120_000,
      input: prompt,
    });
    if (exitCode !== 0) throw new Error(classifyCopilotError(stderr, exitCode));
    return parseCopilotResponse(stdout);
  }
}

export type CopilotAgentResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  text: string | null;
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * Run the Copilot CLI as an AGENT in a directory — `copilot -p "<prompt>"
 * --allow-all-tools -C <cwd>` — letting it write files with its own tools. This
 * is the build path for a Copilot login with no key (the harness can't drive a
 * tool loop through the completion API there); the deterministic evaluator still
 * gates whatever it produces, so we never trust Copilot's self-assessment.
 */
export async function runCopilotAgent(opts: {
  prompt: string;
  cwd: string;
  bin?: CopilotBin;
  model?: string;
  exec?: CopilotExec;
  timeoutMs?: number;
}): Promise<CopilotAgentResult> {
  const exec = opts.exec ?? defaultExec(opts.bin ?? 'copilot');
  const args = ['--allow-all-tools', '-C', opts.cwd, '--output-format', 'json'];
  if (opts.model) args.push('--model', opts.model);
  const r = await exec(args, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 600_000,
    input: opts.prompt,
  });
  if (r.exitCode !== 0) throw new Error(classifyCopilotError(r.stderr, r.exitCode));
  const parsed = parseCopilotResponse(r.stdout);
  return { ...r, text: parsed.content, usage: parsed.usage };
}

export type CopilotStatus = {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  model?: string;
  detail: string;
};

/** Read the model from `~/.copilot/settings.json` (best-effort). */
function readCopilotModel(settingsPath?: string): string | undefined {
  const path = settingsPath ?? join(homedir(), '.copilot', 'settings.json');
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (typeof cfg.model === 'string') return cfg.model;
    const chat = cfg.chat as Record<string, unknown> | undefined;
    if (chat && typeof chat.model === 'string') return chat.model;
  } catch {
    // no settings file / unreadable
  }
  return undefined;
}

/**
 * Detect a usable Copilot CLI for `doctor`/`init`: installed (via `--version`),
 * the configured model, and — when `probeAuth` is set — whether the session is
 * authenticated (a tiny completion; classified, never throws).
 */
export async function detectCopilot(
  opts: {
    bin?: CopilotBin;
    exec?: CopilotExec;
    settingsPath?: string;
    probeAuth?: boolean;
  } = {},
): Promise<CopilotStatus> {
  const exec = opts.exec ?? defaultExec(opts.bin ?? 'copilot');
  let installed = false;
  let version: string | undefined;
  try {
    const v = await exec(['--version'], { timeoutMs: 10_000 });
    if (v.exitCode === 0) {
      installed = true;
      version = v.stdout.trim().split(/\r?\n/)[0];
    }
  } catch {
    // not installed
  }
  if (!installed) {
    return { installed: false, authenticated: false, detail: 'copilot CLI not found on PATH' };
  }

  const model = readCopilotModel(opts.settingsPath);
  if (!opts.probeAuth) {
    return {
      installed,
      version,
      model,
      authenticated: false,
      detail: 'auth verified on first use',
    };
  }

  try {
    const probe = await exec(['--output-format', 'json'], {
      timeoutMs: 30_000,
      input: 'reply with: ok',
    });
    if (probe.exitCode === 0) {
      return { installed, version, model, authenticated: true, detail: 'authenticated' };
    }
    return {
      installed,
      version,
      model,
      authenticated: false,
      detail: classifyCopilotError(probe.stderr, probe.exitCode),
    };
  } catch (e) {
    return { installed, version, model, authenticated: false, detail: String(e) };
  }
}
