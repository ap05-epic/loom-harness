import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { LlmGateway, ToolDef } from '@loom/agents';
import {
  GateStore,
  QuestionStore,
  type Profile,
  type ProfileStore,
  type SqliteDatabase,
} from '@loom/core';
import type { ToolRisk } from '@loom/tools';

/**
 * Everything the chat tools operate on — opened once, bound into each tool for the session.
 *
 * `commands` and `readiness` are the two seams that keep `@loom/chat` free of any CLI dependency:
 * the host (the CLI today, Mission Control tomorrow) injects its command list and a profile-readiness
 * probe, so the portable tools work identically in a terminal REPL and a browser chat.
 */
export type ChatSession = {
  db: SqliteDatabase;
  gateway: LlmGateway;
  profile: Profile;
  version: string;
  /** The directory the code/file/exec tools are confined to (the repo/project the user is in). */
  root: string;
  /** The repo `docs/` dir for `read_doc` (when chat runs from the clone), if present. */
  docsDir?: string;
  /**
   * CLI commands surfaced by `list_commands`. Injected by the host so `@loom/chat` never imports the
   * CLI command registry (which would be a dependency cycle). The CLI populates it; the server omits it.
   */
  commands?: Array<{ name: string; describe: string }>;
  /**
   * Optional readiness probe surfaced by `show_profile` / `configure_project`. The host wires this to
   * its pipeline-config resolver so chat can report "ready to run" without `@loom/chat` depending on
   * the conductor or the CLI's config layer.
   */
  readiness?: () => { ready: boolean; problem?: string };
  /**
   * The profile learning root — the durable, cross-project memory + skills shared by every project on
   * the same profile. When present, recall merges its facts and `memory_remember` can promote a fact
   * to the profile tier. Omit and chat works on the project tier alone.
   */
  profileStore?: ProfileStore;
};

/** A harness tool the agent can call, plus its risk (for the permission policy). */
export type ChatTool = { def: ToolDef; risk: ToolRisk };

export const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const;

/** Build one {@link ChatTool} — the def the model sees plus its permission risk. */
export function tool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  risk: ToolRisk,
  execute: (args: unknown) => Promise<string>,
): ChatTool {
  return { def: { name, description, parameters, execute }, risk };
}

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.loom',
  '.loom-data',
]);

/** Resolve a path under `root`, or null if it escapes (the file/exec confinement guard). */
export function confine(root: string, p: string): string | null {
  const abs = resolve(root, p);
  return relative(root, abs).startsWith('..') ? null : abs;
}

const PROTECTED_DIR_SEGMENTS = new Set(['.git', 'node_modules']);
const PROTECTED_FILES = new Set(['loom.config.yaml', 'harness.config.yaml']);

/**
 * Guard a write/edit path: it must resolve inside `root` AND must not touch a protected location —
 * secrets (`.env*`), VCS internals (`.git`), dependencies (`node_modules`), or the project config
 * (which has its own `configure_project` tool). Returns the absolute path when allowed, else a
 * refusal reason the model can act on. This is the deny-list half of file safety; {@link confine} is
 * the escape half.
 */
export function writeGuard(
  root: string,
  p: string,
): { ok: true; abs: string } | { ok: false; reason: string } {
  const abs = confine(root, p);
  if (!abs) return { ok: false, reason: `path "${p}" resolves outside the project root` };
  const segs = relative(root, abs).split(sep).filter(Boolean);
  if (segs.some((s) => PROTECTED_DIR_SEGMENTS.has(s)))
    return { ok: false, reason: `"${p}" is a protected path (.git / node_modules)` };
  const base = segs[segs.length - 1] ?? '';
  if (base === '.env' || base.startsWith('.env.') || PROTECTED_FILES.has(base))
    return { ok: false, reason: `"${p}" is a protected file (secrets or project config)` };
  return { ok: true, abs };
}

/** Recursive substring grep — the fallback when ripgrep isn't installed. */
export function jsGrep(
  root: string,
  query: string,
  glob: string | undefined,
  limit: number,
): string[] {
  const out: string[] = [];
  const q = query.toLowerCase();
  const needle = glob?.replace(/\*/g, '');
  const walk = (dir: string): void => {
    if (out.length >= limit) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
        continue;
      }
      if (needle && !e.name.includes(needle)) continue;
      const file = join(dir, e.name);
      let text: string;
      try {
        if (statSync(file).size > 512 * 1024) continue;
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && out.length < limit; i++) {
        if (lines[i]!.toLowerCase().includes(q)) {
          out.push(`${relative(root, file)}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
        }
      }
    }
  };
  walk(root);
  return out;
}

/** One-line inbox summary used by `status` (and the host's run/resume tools). */
export function inboxLine(db: SqliteDatabase): string {
  const gates = new GateStore(db).list({ status: 'open' }).length;
  const questions = new QuestionStore(db).list({ status: 'open' }).length;
  return `${gates} gate(s) + ${questions} question(s) awaiting you`;
}
