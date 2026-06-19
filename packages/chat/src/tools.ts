import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  applyGateDecision,
  GateStore,
  loadProfile,
  QuestionStore,
  saveProfile,
  SkillStore,
  TaskStore,
  type ProfileConfig,
} from '@loom/core';
import {
  confine,
  inboxLine,
  jsGrep,
  NO_ARGS,
  SKIP_DIRS,
  tool,
  type ChatSession,
  type ChatTool,
} from './session.js';
import { buildFsTools } from './fs-tools.js';
import { buildMemoryTools } from './memory-tools.js';

/**
 * The Hermes-grade capability tools: search/read the codebase, run gated shell commands, and
 * introspect Loom's own commands/docs/skills/tools. Adapted from Hermes Agent (MIT) patterns —
 * reimplemented onto Loom's permission policy + ToolDef substrate. The read tools run freely;
 * `run_command` is `expensive` so the user approves every shell call. `tools` is the live array
 * (so `list_tools` can describe the whole set, itself included).
 */
function buildCodeTools(session: ChatSession, tools: ChatTool[]): ChatTool[] {
  const { root } = session;
  return [
    tool(
      'search_code',
      'Search the codebase for a string/regex (ripgrep, with a fallback). Returns file:line matches. Use to find where something is.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'the text or regex to search for' },
          glob: { type: 'string', description: 'optional filename filter, e.g. "*.ts"' },
          maxResults: { type: 'number', description: 'cap on matches (default 40)' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      'read',
      async (a) => {
        const { query, glob, maxResults } = a as {
          query?: string;
          glob?: string;
          maxResults?: number;
        };
        if (!query) return 'search_code needs a "query".';
        const limit = Math.min(maxResults ?? 40, 200);
        const args = ['--line-number', '--no-heading', '--color=never', '-S', '-m', String(limit)];
        if (glob) args.push('-g', glob);
        args.push(query, '.');
        const rg = spawnSync('rg', args, {
          cwd: root,
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        if (rg.error && (rg.error as NodeJS.ErrnoException).code === 'ENOENT') {
          const hits = jsGrep(root, query, glob, limit);
          return hits.length ? hits.join('\n') : '(no matches)';
        }
        const lines = (rg.stdout || '').split('\n').filter(Boolean).slice(0, limit);
        return lines.length ? lines.join('\n') : '(no matches)';
      },
    ),
    tool(
      'read_file',
      'Read a file from the project (optionally a line window). Paths are relative to the project root.',
      {
        type: 'object',
        properties: {
          path: { type: 'string' },
          startLine: { type: 'number' },
          endLine: { type: 'number' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      'read',
      async (a) => {
        const { path, startLine, endLine } = a as {
          path?: string;
          startLine?: number;
          endLine?: number;
        };
        if (!path) return 'read_file needs a "path".';
        const file = confine(root, path);
        if (!file || !existsSync(file)) return `Not found (or outside the project): ${path}`;
        let text: string;
        try {
          text = readFileSync(file, 'utf8');
        } catch (e) {
          return `Could not read ${path}: ${String(e)}`;
        }
        const lines = text.split('\n');
        const from = Math.max(1, startLine ?? 1);
        const to = Math.min(lines.length, endLine ?? from + 399);
        return lines
          .slice(from - 1, to)
          .map((l, i) => `${from + i}\t${l}`)
          .join('\n')
          .slice(0, 64 * 1024);
      },
    ),
    tool(
      'list_files',
      'List files under a directory of the project (recursively, capped). Paths are relative to the project root.',
      {
        type: 'object',
        properties: { dir: { type: 'string' }, glob: { type: 'string' } },
        additionalProperties: false,
      },
      'read',
      async (a) => {
        const { dir, glob } = a as { dir?: string; glob?: string };
        const base = confine(root, dir ?? '.');
        if (!base || !existsSync(base)) return `Not found (or outside the project): ${dir ?? '.'}`;
        const needle = glob?.replace(/\*/g, '');
        const out: string[] = [];
        const walk = (d: string): void => {
          if (out.length >= 300) return;
          let entries: Dirent[];
          try {
            entries = readdirSync(d, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of entries) {
            if (out.length >= 300) return;
            if (e.isDirectory()) {
              if (!SKIP_DIRS.has(e.name)) walk(join(d, e.name));
              continue;
            }
            if (needle && !e.name.includes(needle)) continue;
            out.push(relative(root, join(d, e.name)));
          }
        };
        walk(base);
        return out.length ? out.join('\n') : '(no files)';
      },
    ),
    tool(
      'run_command',
      'Run a shell command (e.g. curl, git, node, a build) in the project. NO implicit shell — pass the program + args array. The user approves every run.',
      {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'the program, e.g. "git" or "curl"' },
          args: { type: 'array', items: { type: 'string' }, description: 'argument list' },
          cwd: { type: 'string', description: 'working dir, relative to the project root' },
          timeoutMs: { type: 'number' },
        },
        required: ['command'],
        additionalProperties: false,
      },
      'expensive',
      async (a) => {
        const { command, args, cwd, timeoutMs } = a as {
          command?: string;
          args?: string[];
          cwd?: string;
          timeoutMs?: number;
        };
        if (!command) return 'run_command needs a "command".';
        const wd = confine(root, cwd ?? '.');
        if (!wd) return 'cwd is outside the project.';
        const argv = Array.isArray(args) ? args : [];
        const r = spawnSync(command, argv, {
          cwd: wd,
          encoding: 'utf8',
          shell: false,
          timeout: Math.min(timeoutMs ?? 30_000, 120_000),
          maxBuffer: 8 * 1024 * 1024,
        });
        if (r.error) return `Failed to run ${command}: ${(r.error as Error).message}`;
        const body = ((r.stdout || '') + (r.stderr ? `\n[stderr]\n${r.stderr}` : '')).slice(
          0,
          32 * 1024,
        );
        return `$ ${command} ${argv.join(' ')}\n(exit ${r.status ?? 'null'})\n${body || '(no output)'}`;
      },
    ),
    tool(
      'list_commands',
      "List Loom's own CLI commands (so you know what `loom …` can do).",
      NO_ARGS,
      'read',
      async () => {
        const cmds = session.commands ?? [];
        return cmds.length
          ? cmds.map((c) => `loom ${c.name} — ${c.describe}`).join('\n')
          : '(no commands available in this surface)';
      },
    ),
    tool(
      'list_skills',
      "List the project's reusable skills (optionally matching a query).",
      {
        type: 'object',
        properties: { query: { type: 'string' } },
        additionalProperties: false,
      },
      'read',
      async (a) => {
        const { query } = a as { query?: string };
        const store = new SkillStore(session.db);
        const project = session.profile.project;
        const skills = query
          ? store.recall(project, { terms: query.split(/\W+/).filter((w) => w.length >= 3) })
          : store.list({ project, status: 'active' });
        return skills.length
          ? skills.map((s) => `${s.name} — ${s.description}`).join('\n')
          : '(no skills)';
      },
    ),
    tool(
      'read_doc',
      "Read Loom's own documentation under docs/ (no path lists the available docs).",
      {
        type: 'object',
        properties: { path: { type: 'string' } },
        additionalProperties: false,
      },
      'read',
      async (a) => {
        const { path } = a as { path?: string };
        if (!session.docsDir || !existsSync(session.docsDir))
          return 'docs are not available in this install.';
        if (!path) {
          const out: string[] = [];
          const walk = (d: string, pre: string): void => {
            for (const e of readdirSync(d, { withFileTypes: true })) {
              if (e.isDirectory()) walk(join(d, e.name), `${pre}${e.name}/`);
              else if (e.name.endsWith('.md')) out.push(`${pre}${e.name}`);
            }
          };
          try {
            walk(session.docsDir, '');
          } catch {
            // unreadable docs dir
          }
          return out.length ? `docs/:\n${out.join('\n')}` : '(no docs)';
        }
        const file = confine(session.docsDir, path.replace(/^docs\//, ''));
        if (!file || !existsSync(file)) return `Doc not found: ${path}`;
        try {
          return readFileSync(file, 'utf8').slice(0, 48 * 1024);
        } catch (e) {
          return `Could not read ${path}: ${String(e)}`;
        }
      },
    ),
    tool('list_tools', 'List the tools you (the chat agent) can call.', NO_ARGS, 'read', async () =>
      tools.map((t) => `${t.def.name} [${t.risk}] — ${t.def.description}`).join('\n'),
    ),
  ];
}

/** Report the profile's runnability via the host-injected readiness probe (if any). */
function readinessLine(session: ChatSession): string {
  const r = session.readiness?.();
  if (!r) return 'status: (readiness unknown in this surface)';
  return r.ready
    ? 'status: ready to run (map, then run)'
    : `status: not runnable yet — ${r.problem}`;
}

/**
 * Build the harness-driving toolset for one chat session. Read tools just query the db; inbox tools
 * change state and are gated by the permission policy (see {@link agenticChatTurn}). The host may pass
 * `extraTools` — e.g. the CLI's pipeline-executing tools (map/run/resume), which depend on the
 * conductor and so live outside `@loom/chat`. A browser surface omits them (it triggers stages out of
 * band) so the server never drives a pipeline inline.
 */
export function buildChatTools(
  session: ChatSession,
  opts: { extraTools?: ChatTool[] } = {},
): ChatTool[] {
  const { db } = session;

  const tools: ChatTool[] = [
    tool(
      'status',
      'Show the current run: status/stage, screens by state, token spend, and the open inbox.',
      NO_ARGS,
      'read',
      async () => {
        const tasks = new TaskStore(db);
        const run = tasks.latestRun({ status: 'running' }) ?? tasks.latestRun();
        if (!run) return 'No runs yet — the pipeline has not been started (use map, then run).';
        const wps = tasks.listWorkPackages(run.id);
        const n = (s: string) => wps.filter((w) => w.state === s).length;
        const usage = tasks.usageRollup(run.id);
        return [
          `run ${run.id} — ${run.status}${run.stage ? `, stage ${run.stage}` : ''}`,
          `screens: ${wps.length} total (passed ${n('passed')}, shipped ${n('shipped')}, building ${n('building')}, blocked ${n('blocked')}, needs_human ${n('needs_human')})`,
          `tokens: ${usage.inputTokens + usage.outputTokens}`,
          `inbox: ${inboxLine(db)}`,
        ].join('\n');
      },
    ),

    tool(
      'list_gates',
      'List the gates awaiting your approval (plan/deviation/ship/skill), with their ids.',
      NO_ARGS,
      'read',
      async () => {
        const gates = new GateStore(db).list({ status: 'open' });
        if (!gates.length) return 'No open gates.';
        return gates.map((g) => `${g.id} — ${g.type} on ${g.scopeId}`).join('\n');
      },
    ),

    tool(
      'list_questions',
      "List the agent's open questions awaiting your answer, with their ids.",
      NO_ARGS,
      'read',
      async () => {
        const qs = new QuestionStore(db).list({ status: 'open' });
        if (!qs.length) return 'No open questions.';
        return qs.map((q) => `${q.id} — ${q.question}`).join('\n');
      },
    ),

    tool(
      'show_profile',
      'Show the current project profile and what (if anything) is missing before it can run.',
      NO_ARGS,
      'read',
      async () => {
        const p = session.profile;
        const lines = [
          `project: ${p.project}`,
          `model: ${p.llm.driver} / ${p.llm.model}`,
          `source.strutsConfig: ${p.source?.strutsConfig ?? '(not set)'}`,
          `app.baseUrl: ${p.app?.baseUrl ?? '(not set)'}`,
          `target.bRepo: ${p.target?.bRepo ?? 'b-repo (default)'}`,
          `eval.threshold: ${p.eval?.threshold ?? 1}%`,
          // explore/crawl config — what `loom explore` needs to log itself in and walk the app
          `crawl.startPath: ${p.crawl?.startPath ?? '(not set)'}`,
          `crawl.faEnv: ${p.crawl?.faEnv ?? '(default fa_numbers)'}`,
          `crawl.hydrateMs: ${p.crawl?.hydrateMs ?? '(none)'}`,
          `app.cookiesPath: ${p.app?.cookiesPath ?? '(not set)'}`,
        ];
        lines.push(readinessLine(session));
        return lines.join('\n');
      },
    ),

    tool(
      'configure_project',
      'Set up or update the project profile from what the user told you about their app. Collect ' +
        'the values in conversation first, then call this. Covers both the rebuild fields and the ' +
        'explore/crawl fields (startPath, faEnv, hydrateMs) that make `loom explore` work without ' +
        'hand-editing YAML. Writes loom.config.yaml — never secrets (those go in .env).',
      {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'project name' },
          strutsConfig: {
            type: 'string',
            description: 'path to the legacy struts-config.xml (the MAP source)',
          },
          baseUrl: {
            type: 'string',
            description: 'URL of the running legacy app to match (the baseline)',
          },
          bRepo: {
            type: 'string',
            description: 'directory to write the rebuild into (default b-repo)',
          },
          threshold: { type: 'number', description: 'max visual diff %% to pass (default 1)' },
          storageStatePath: {
            type: 'string',
            description: 'saved SSO auth-state file, for login-gated apps',
          },
          cookiesPath: {
            type: 'string',
            description: 'JSON file of browser cookies, reloaded each run (login-gated apps)',
          },
          startPath: {
            type: 'string',
            description:
              'where `loom explore` starts crawling after auth (e.g. jsp/loginAction.do)',
          },
          faEnv: {
            type: 'string',
            description:
              'env var holding the FA Quick-Search code the explorer types (default fa_numbers)',
          },
          hydrateMs: {
            type: 'number',
            description: 'ms to wait for late-AJAX menus to appear before reading a page',
          },
          maxStates: { type: 'number', description: 'cap on how many screens a crawl maps' },
        },
        additionalProperties: false,
      },
      'expensive',
      async (args) => {
        const a = (args ?? {}) as {
          project?: string;
          strutsConfig?: string;
          baseUrl?: string;
          bRepo?: string;
          threshold?: number;
          storageStatePath?: string;
          cookiesPath?: string;
          startPath?: string;
          faEnv?: string;
          hydrateMs?: number;
          maxStates?: number;
        };
        const p = session.profile;
        const baseUrl = a.baseUrl ?? p.app?.baseUrl;
        const storageStatePath = a.storageStatePath ?? p.app?.storageStatePath;
        const cookiesPath = a.cookiesPath ?? p.app?.cookiesPath;
        // Merge any explore/crawl fields onto the existing crawl config (auth/exclude preserved).
        const crawl =
          a.startPath != null || a.faEnv != null || a.hydrateMs != null || a.maxStates != null
            ? {
                ...(p.crawl ?? {}),
                ...(a.startPath != null ? { startPath: a.startPath } : {}),
                ...(a.faEnv != null ? { faEnv: a.faEnv } : {}),
                ...(a.hydrateMs != null ? { hydrateMs: a.hydrateMs } : {}),
                ...(a.maxStates != null ? { maxStates: a.maxStates } : {}),
              }
            : p.crawl;
        const config: ProfileConfig = {
          project: a.project ?? p.project,
          llm: p.llm,
          source: a.strutsConfig ? { strutsConfig: a.strutsConfig } : p.source,
          app: baseUrl
            ? {
                baseUrl,
                ...(storageStatePath ? { storageStatePath } : {}),
                ...(cookiesPath ? { cookiesPath } : {}),
              }
            : p.app,
          target: a.bRepo ? { bRepo: a.bRepo } : p.target,
          eval: a.threshold != null ? { ...(p.eval ?? {}), threshold: a.threshold } : p.eval,
          crawl,
          mcp: p.mcp,
          skills: p.skills,
        };
        let saved: string;
        try {
          saved = saveProfile(config, p.dir);
        } catch (error) {
          return `Could not save the profile — ${
            error instanceof Error ? error.message : String(error)
          }. Ask the user for the missing value.`;
        }
        // Reload so this session — and the next map/run — sees the update.
        session.profile = loadProfile(p.dir, p.dataDir ? { dataDir: p.dataDir } : {});
        const r = session.readiness?.();
        return r && !r.ready
          ? `Saved ${saved}. Still not runnable — ${r.problem}. Ask the user for the missing value.`
          : `Saved ${saved}. The project is ready — source + app are set. Offer to run \`map\`, then \`run\`.`;
      },
    ),

    tool(
      'approve_gate',
      'Approve an open gate by id (e.g. ship a passed screen). Optionally include a note.',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the gate id' },
          note: { type: 'string', description: 'optional decision note' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      'expensive',
      async (args) => {
        const { id, note } = args as { id: string; note?: string };
        const res = applyGateDecision(db, id, 'approved', note);
        return res
          ? `Approved gate ${id}.`
          : `No open gate with id "${id}" (unknown or already decided).`;
      },
    ),

    tool(
      'reject_gate',
      'Reject an open gate by id. Optionally include a note explaining why.',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the gate id' },
          note: { type: 'string', description: 'optional reason' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      'expensive',
      async (args) => {
        const { id, note } = args as { id: string; note?: string };
        const res = applyGateDecision(db, id, 'rejected', note);
        return res
          ? `Rejected gate ${id}.`
          : `No open gate with id "${id}" (unknown or already decided).`;
      },
    ),

    tool(
      'answer_question',
      "Answer an open agent question by id, unblocking its screen. Then run 'resume' to retry it.",
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the question id' },
          answer: { type: 'string', description: 'your answer' },
        },
        required: ['id', 'answer'],
        additionalProperties: false,
      },
      'expensive',
      async (args) => {
        const { id, answer } = args as { id: string; answer: string };
        const store = new QuestionStore(db);
        const q = store.get(id);
        if (!q || q.status !== 'open') return `No open question with id "${id}".`;
        store.answer(id, answer);
        return `Answered question ${id}. Use 'resume' to retry its screen.`;
      },
    ),
  ];

  // Append the Hermes-grade code/file/exec + self-knowledge tools (they reference `tools` so
  // `list_tools` can describe the full set), then the file-mutation and memory tools.
  for (const t of buildCodeTools(session, tools)) tools.push(t);
  for (const t of buildFsTools(session)) tools.push(t);
  for (const t of buildMemoryTools(session)) tools.push(t);
  // Host-provided tools (e.g. the CLI's pipeline tools) — pushed into the same array so `list_tools`
  // describes them too.
  if (opts.extraTools) for (const t of opts.extraTools) tools.push(t);
  return tools;
}
