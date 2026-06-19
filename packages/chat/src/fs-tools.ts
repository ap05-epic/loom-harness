import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tool, writeGuard, type ChatSession, type ChatTool } from './session.js';

/**
 * The agent's file-mutation tools — `write_file` and `edit_file`. Both are confined to the project
 * root and refuse protected paths (secrets, `.git`, `node_modules`, the project config) via
 * {@link writeGuard}, and both are `expensive` so the permission gate asks before any write. This is
 * the half of Hermes parity Loom's chat lacked: the agent can now change files, not just read them.
 */
export function buildFsTools(session: ChatSession): ChatTool[] {
  const { root } = session;
  return [
    tool(
      'write_file',
      'Write a UTF-8 text file in the project (creating parent dirs). "path" is relative to the ' +
        'project root; writing outside it, or to a protected path (.env, .git, node_modules, ' +
        'loom.config.yaml), is refused. Overwrites an existing file — prefer edit_file for a tweak.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'path relative to the project root' },
          content: { type: 'string', description: 'full file contents (UTF-8)' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      'expensive',
      async (a) => {
        const { path, content } = a as { path?: string; content?: string };
        if (!path) return 'write_file needs a "path".';
        if (typeof content !== 'string') return 'write_file needs string "content".';
        const g = writeGuard(root, path);
        if (!g.ok) return `Refused: ${g.reason}.`;
        try {
          mkdirSync(dirname(g.abs), { recursive: true });
          writeFileSync(g.abs, content, 'utf8');
        } catch (e) {
          return `Could not write ${path}: ${e instanceof Error ? e.message : String(e)}`;
        }
        return `Wrote ${path} (${Buffer.byteLength(content, 'utf8')} bytes).`;
      },
    ),
    tool(
      'edit_file',
      'Replace an exact substring in a project file. "oldString" must appear EXACTLY once — include ' +
        'enough surrounding context to make it unique. "path" is relative to the project root; ' +
        'protected paths are refused. Use this for a targeted change; use write_file for a new file.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'path relative to the project root' },
          oldString: { type: 'string', description: 'the exact text to replace (must be unique)' },
          newString: { type: 'string', description: 'the replacement text' },
        },
        required: ['path', 'oldString', 'newString'],
        additionalProperties: false,
      },
      'expensive',
      async (a) => {
        const { path, oldString, newString } = a as {
          path?: string;
          oldString?: string;
          newString?: string;
        };
        if (!path || typeof oldString !== 'string' || typeof newString !== 'string')
          return 'edit_file needs "path", "oldString", and "newString".';
        if (oldString.length === 0) return 'edit_file "oldString" must be non-empty.';
        const g = writeGuard(root, path);
        if (!g.ok) return `Refused: ${g.reason}.`;
        if (!existsSync(g.abs)) return `Not found: ${path}`;
        let text: string;
        try {
          text = readFileSync(g.abs, 'utf8');
        } catch (e) {
          return `Could not read ${path}: ${e instanceof Error ? e.message : String(e)}`;
        }
        const count = text.split(oldString).length - 1;
        if (count === 0)
          return `No match for the given oldString in ${path}. Read the file and copy the exact text.`;
        if (count > 1)
          return `oldString is not unique in ${path} (${count} matches). Include more surrounding context.`;
        try {
          writeFileSync(g.abs, text.replace(oldString, newString), 'utf8');
        } catch (e) {
          return `Could not write ${path}: ${e instanceof Error ? e.message : String(e)}`;
        }
        return `Edited ${path}.`;
      },
    ),
  ];
}
