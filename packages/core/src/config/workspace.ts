import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * A workspace: a `loom-workspace.yaml` manifest holding N named projects and an active pointer, so
 * multiple modernization projects coexist with fully isolated data/skills/memory. Self-contained
 * (relative project dirs travel with the workspace folder); the CLI is its only writer. Profiles
 * are untouched — a lone `loom.config.yaml` with no workspace behaves exactly as before.
 */

export const WORKSPACE_FILE = 'loom-workspace.yaml';

const workspaceSchema = z.object({
  version: z.number().int().positive(),
  /** The selected project's name (matches a `projects[].name`). */
  active: z.string().optional(),
  projects: z.array(z.object({ name: z.string().min(1), dir: z.string().min(1) })),
});

export type Workspace = z.infer<typeof workspaceSchema> & {
  /** Directory the manifest lives in (project dirs resolve relative to it). */
  dir: string;
  /** Absolute path to the manifest. */
  path: string;
};

/** Parse + validate a `loom-workspace.yaml`. */
export function loadWorkspace(path: string): Workspace {
  const abs = resolve(path);
  const raw: unknown = parseYaml(readFileSync(abs, 'utf8'));
  const parsed = workspaceSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid ${basename(abs)}: ${issues}`);
  }
  return { ...parsed.data, dir: dirname(abs), path: abs };
}

/** Walk up from `startDir` to find the nearest `loom-workspace.yaml`; `null` if none. */
export function findWorkspaceUp(startDir: string): string | null {
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, WORKSPACE_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
