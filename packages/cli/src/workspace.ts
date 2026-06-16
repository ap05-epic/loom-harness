import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findWorkspaceUp, loadWorkspace, WORKSPACE_FILE, type Workspace } from '@loom/core';
import { configError } from './errors.js';

/** Which project's profile dir + (per-project) data dir a command should use. */
export type ProjectResolution = { profileDir: string; dataDir?: string; project?: string };

export type ResolveInput = {
  flags: { profile?: string; dataDir?: string; project?: string; workspace?: string };
  env: Record<string, string | undefined>;
  cwd: string;
};

const projectDataDir = (ws: Workspace, dir: string): string => join(resolve(ws.dir, dir), 'data');

/** A hand-edited manifest must not alias two projects onto the same data dir (their data would mix). */
function assertNoDuplicateDataDirs(ws: Workspace): void {
  const seen = new Map<string, string>();
  for (const p of ws.projects) {
    const dd = projectDataDir(ws, p.dir);
    const prior = seen.get(dd);
    if (prior) {
      throw configError(
        `workspace projects "${prior}" and "${p.name}" resolve to the same data dir (${dd})`,
        'give each project its own dir in loom-workspace.yaml',
      );
    }
    seen.set(dd, p.name);
  }
}

/**
 * Resolve which project a command runs against. Resolution order (the first match wins):
 *   1. an explicit `--profile`/`--data-dir` (or `LOOM_PROFILE`/`LOOM_DATA_DIR`/`HARNESS_*`) ⇒ the
 *      legacy single-profile path, workspace ignored — this preserves every existing flow + test;
 *   2. `--project` / `LOOM_PROJECT` resolved within a discoverable workspace;
 *   3. the workspace's `active` project;
 *   4. no workspace at all ⇒ today's behavior (cwd as the profile dir, `LOOM_DATA_DIR` if set).
 * Each workspace project gets its OWN data dir (`<project>/data`), so two projects can never share
 * loom.db / the atlases / b-repo.
 */
export function resolveProjectContext(input: ResolveInput): ProjectResolution {
  const { flags, env, cwd } = input;

  // 1. Explicit profile/data-dir ⇒ legacy path; the workspace is not consulted.
  const explicitProfile = flags.profile ?? env.LOOM_PROFILE ?? env.HARNESS_PROFILE;
  const explicitDataDir = flags.dataDir ?? env.LOOM_DATA_DIR ?? env.HARNESS_DATA_DIR;
  if (explicitProfile || explicitDataDir) {
    return {
      profileDir: explicitProfile ?? cwd,
      ...(explicitDataDir ? { dataDir: explicitDataDir } : {}),
    };
  }

  // 2. Locate a workspace (explicit dir, env, or by walking up from cwd).
  const wsDir = flags.workspace ?? env.LOOM_WORKSPACE;
  let wsPath: string | null;
  if (wsDir) {
    wsPath = join(resolve(wsDir), WORKSPACE_FILE);
    if (!existsSync(wsPath)) {
      throw configError(
        `no ${WORKSPACE_FILE} in ${wsDir}`,
        'run `loom project new <name>` to scaffold a workspace',
      );
    }
  } else {
    wsPath = findWorkspaceUp(cwd);
  }

  if (wsPath) {
    const ws = loadWorkspace(wsPath);
    assertNoDuplicateDataDirs(ws);
    const wantName = flags.project ?? env.LOOM_PROJECT ?? ws.active;
    if (wantName) {
      const proj = ws.projects.find((p) => p.name === wantName);
      if (!proj) {
        throw configError(
          `project "${wantName}" is not in the workspace (${ws.path})`,
          'run `loom project list` to see the projects',
        );
      }
      const projDir = resolve(ws.dir, proj.dir);
      return { profileDir: projDir, dataDir: join(projDir, 'data'), project: proj.name };
    }
  }

  // 3. No workspace / no active project ⇒ today's behavior.
  return { profileDir: cwd };
}
