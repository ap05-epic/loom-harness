import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { ToolDef } from '@loom/agents';
import { openCrawlDb } from './crawl-db.js';

/** Resolve `p` within the first allowed root it stays inside; null if it escapes all of them. */
function confine(roots: string[], p: string): string | null {
  for (const root of roots) {
    const abs = resolve(root, p);
    if (!relative(resolve(root), abs).startsWith('..')) return abs;
  }
  return null;
}

const READ_CAP = 60_000;
const LIST_CAP = 300;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'WEB-INF', 'META-INF']);

/** A confined, read-only `read_file` tool over the legacy source + crawl artifact roots. */
export function createReadFileTool(roots: string[]): ToolDef {
  return {
    name: 'read_file',
    description:
      'Read a UTF-8 text file — the legacy JSP/Struts source, or a crawl artifact (e.g. a saved ' +
      'response body to see the exact data fields). Large files are truncated; reads are confined.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (within an allowed legacy/crawl root).' },
        startLine: { type: 'number', description: 'Optional 1-based start line.' },
        endLine: { type: 'number', description: 'Optional 1-based end line (inclusive).' },
      },
      required: ['path'],
    },
    execute(args: unknown): string {
      const { path, startLine, endLine } = (args ?? {}) as {
        path?: string;
        startLine?: number;
        endLine?: number;
      };
      if (!path) return 'Error: path is required.';
      const abs = confine(roots, path);
      if (!abs) return `Refused: ${path} is outside the allowed roots.`;
      try {
        const lines = readFileSync(abs, 'utf8').split('\n');
        const from = startLine ? Math.max(0, startLine - 1) : 0;
        const to = endLine ? Math.min(lines.length, endLine) : lines.length;
        return lines.slice(from, to).join('\n').slice(0, READ_CAP);
      } catch (e) {
        return `Error reading ${path}: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  };
}

/** A confined, recursive `list_files` tool (capped) so the builder can discover what's available. */
export function createListFilesTool(roots: string[]): ToolDef {
  return {
    name: 'list_files',
    description:
      'List files under a directory within the legacy source / crawl artifacts (recursive, capped).',
    parameters: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Directory within an allowed root (default: the root).',
        },
      },
      required: [],
    },
    execute(args: unknown): string {
      const { dir } = (args ?? {}) as { dir?: string };
      const base = confine(roots, dir ?? '.');
      if (!base) return `Refused: ${dir} is outside the allowed roots.`;
      const out: string[] = [];
      const walk = (d: string): void => {
        if (out.length >= LIST_CAP) return;
        let entries;
        try {
          entries = readdirSync(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (out.length >= LIST_CAP) break;
          if (SKIP_DIRS.has(e.name)) continue;
          const full = join(d, e.name);
          if (e.isDirectory()) walk(full);
          else out.push(relative(base, full).split(sep).join('/'));
        }
      };
      try {
        if (statSync(base).isDirectory()) walk(base);
        else out.push(base);
      } catch {
        /* unreadable */
      }
      return out.length > 0 ? out.join('\n') : '(no files)';
    },
  };
}

/**
 * A `query_crawl` tool: the builder asks the runtime crawl DB for a screen's user-path links, its data
 * endpoints, and which endpoint backs each rendered value (provenance) — so it wires navigation + fetches
 * live data instead of hardcoding. Read-only; the stored data is already FA-redacted.
 */
export function createCrawlQueryTool(crawlDbPath: string, bodiesDir: string): ToolDef {
  return {
    name: 'query_crawl',
    description:
      'Query the runtime crawl DB for a screen: its links (user paths), the backend endpoints it calls, ' +
      'and which endpoint backs each rendered value (data provenance). Use this to reproduce navigation ' +
      'and to fetch live data from the SAME endpoint, never hardcoding the captured numbers.',
    parameters: {
      type: 'object',
      properties: {
        screenKey: {
          type: 'string',
          description: 'The crawl state key (use what:states to list them).',
        },
        stateTag: {
          type: 'string',
          description: 'no-fa or fa:<hash> (default: any matching key).',
        },
        what: {
          type: 'string',
          enum: ['states', 'interactions', 'endpoints', 'provenance', 'summary'],
          description: 'What to return.',
        },
      },
      required: ['what'],
    },
    execute(args: unknown): string {
      const { screenKey, stateTag, what } = (args ?? {}) as {
        screenKey?: string;
        stateTag?: string;
        what?: string;
      };
      let store;
      try {
        store = openCrawlDb(crawlDbPath, { bodiesDir, secrets: [] });
      } catch (e) {
        return `Error opening crawl DB: ${e instanceof Error ? e.message : String(e)}`;
      }
      try {
        const states = store.graph().states;
        if (what === 'states') {
          return (
            states
              .map((s) => `${s.key} [${s.state_tag}] ${s.url}`)
              .join('\n')
              .slice(0, 8000) || '(no states)'
          );
        }
        const st =
          states.find((s) => s.key === screenKey && (!stateTag || s.state_tag === stateTag)) ??
          states.find((s) => s.key === screenKey);
        if (!st) return `No crawled state for key "${screenKey}". Try what:states to list them.`;
        if (what === 'summary') {
          return (
            `${st.key} [${st.state_tag}] ${st.url}\n  ` +
            `${store.interactionsFor(st.id).length} link(s), ${store.endpointsFor(st.id).length} endpoint(s), ` +
            `${store.provenanceFor(st.id).length} value(s)`
          );
        }
        if (what === 'interactions') {
          return (
            store
              .interactionsFor(st.id)
              .map(
                (e) =>
                  `${e.action_kind} "${e.label ?? ''}" → ${e.action_target ?? '?'}${e.is_destructive ? ' (destructive)' : ''}`,
              )
              .join('\n')
              .slice(0, 8000) || '(none)'
          );
        }
        if (what === 'endpoints') {
          return (
            store
              .endpointsFor(st.id)
              .map(
                (e) =>
                  `${e.method} ${e.url} [${e.status ?? '?'}]${e.body_path ? ` body:${e.body_path}` : ''}`,
              )
              .join('\n')
              .slice(0, 8000) || '(none)'
          );
        }
        if (what === 'provenance') {
          return (
            store
              .provenanceFor(st.id)
              .map((p) => `${p.value} ⇐ ${p.endpoint_url ?? '?'}${p.label ? ` (${p.label})` : ''}`)
              .join('\n')
              .slice(0, 8000) || '(none)'
          );
        }
        return 'Error: unknown "what".';
      } finally {
        store.close();
      }
    },
  };
}
