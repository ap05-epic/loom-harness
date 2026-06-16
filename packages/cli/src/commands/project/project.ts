import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createWorkspace,
  findWorkspaceUp,
  loadWorkspace,
  saveWorkspace,
  WORKSPACE_FILE,
  type Workspace,
} from '@loom/core';
import { notFoundError, usageError } from '../../errors.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';
import { requireWorkspace, resolveProjectContext } from '../../workspace.js';

/** Find the workspace (explicit/discovered), or create one at the given/cwd dir. */
function locateOrCreateWorkspace(
  flags: { workspace?: string },
  env: Record<string, string | undefined>,
  cwd: string,
): Workspace {
  const wsDir = flags.workspace ?? env.LOOM_WORKSPACE;
  const wsPath = wsDir ? join(resolve(wsDir), WORKSPACE_FILE) : findWorkspaceUp(cwd);
  if (wsPath && existsSync(wsPath)) return loadWorkspace(wsPath);
  return createWorkspace(wsDir ? resolve(wsDir) : cwd);
}

/** `loom project list` — the projects in the workspace + which is active. */
export const projectListCommand = defineCommand({
  name: 'project list',
  group: 'project',
  describe: 'List the workspace projects and show which one is active',
  exitCodes: ['CONFIG'],
  examples: ['loom project list', 'loom project list --json'],
  run(ctx) {
    const ws = requireWorkspace({ flags: ctx.flags, env: ctx.env, cwd: ctx.cwd });
    return {
      active: ws.active ?? null,
      projects: ws.projects.map((p) => ({
        name: p.name,
        dir: p.dir,
        active: p.name === ws.active,
      })),
    };
  },
  render(data, ctx) {
    const d = data as { projects: Array<{ name: string; dir: string; active: boolean }> };
    ctx.sink.line(
      renderTable(
        d.projects.map((p) => ({ active: p.active ? '*' : '', name: p.name, dir: p.dir })),
        [
          { key: 'active', header: '' },
          { key: 'name', header: 'PROJECT' },
          { key: 'dir', header: 'DIR' },
        ],
      ),
    );
  },
});

/** `loom project current` — the active project + the dirs it resolves to. */
export const projectCurrentCommand = defineCommand({
  name: 'project current',
  group: 'project',
  describe: 'Show the active project and the directories it resolves to',
  exitCodes: ['CONFIG'],
  examples: ['loom project current', 'loom project current --json'],
  run(ctx) {
    const r = resolveProjectContext({ flags: ctx.flags, env: ctx.env, cwd: ctx.cwd });
    return { project: r.project ?? null, profileDir: r.profileDir, dataDir: r.dataDir ?? null };
  },
  render(data, ctx) {
    const d = data as { project: string | null; profileDir: string; dataDir: string | null };
    ctx.sink.line(`project: ${d.project ?? '(none — no workspace active project)'}`);
    ctx.sink.line(`profile: ${d.profileDir}`);
    if (d.dataDir) ctx.sink.line(`data:    ${d.dataDir}`);
  },
});

/** `loom project use <name>` — set the workspace's active project. */
export const projectUseCommand = defineCommand({
  name: 'project use',
  group: 'project',
  describe: 'Set the active project for the workspace',
  args: [{ name: 'name', required: true, describe: 'project name' }],
  exitCodes: ['CONFIG', 'NOT_FOUND'],
  examples: ['loom project use baa'],
  run(ctx, input) {
    const name = String(input.args.name);
    const ws = requireWorkspace({ flags: ctx.flags, env: ctx.env, cwd: ctx.cwd });
    if (!ws.projects.some((p) => p.name === name)) {
      throw notFoundError('project', name, 'run `loom project list` to see the projects');
    }
    saveWorkspace({ ...ws, active: name });
    return { active: name };
  },
  render(data, ctx) {
    ctx.sink.line(`active project → ${(data as { active: string }).active}`);
  },
});

/** `loom project new <name>` — scaffold a project (and the workspace, if needed). */
export const projectNewCommand = defineCommand({
  name: 'project new',
  group: 'project',
  describe: 'Scaffold a new project in the workspace (creating the workspace if needed)',
  args: [{ name: 'name', required: true, describe: 'project name' }],
  exitCodes: ['CONFIG', 'USAGE'],
  examples: ['loom project new baa', 'loom project new claims --workspace ~/loom-data'],
  run(ctx, input) {
    const name = String(input.args.name);
    const ws = locateOrCreateWorkspace(ctx.flags, ctx.env, ctx.cwd);
    if (ws.projects.some((p) => p.name === name)) {
      throw usageError(
        `project "${name}" already exists`,
        `use it with \`loom project use ${name}\``,
      );
    }
    const rel = join('projects', name);
    const projDir = join(ws.dir, rel);
    mkdirSync(join(projDir, 'data'), { recursive: true });
    const configPath = join(projDir, 'loom.config.yaml');
    if (!existsSync(configPath)) {
      // A minimal, valid profile to fill in (source/app/etc. are optional in the schema).
      writeFileSync(
        configPath,
        [`project: ${name}`, 'llm:', '  driver: copilot', '  model: gpt-5.4', ''].join('\n'),
      );
    }
    saveWorkspace({
      ...ws,
      projects: [...ws.projects, { name, dir: rel }],
      active: ws.active ?? name,
    });
    return { name, dir: rel, profileDir: projDir, workspace: ws.path };
  },
  render(data, ctx) {
    const d = data as { name: string; profileDir: string };
    ctx.sink.line(`created project ${d.name} at ${d.profileDir}`);
    ctx.sink.line(
      `next: fill ${d.profileDir}/loom.config.yaml, then \`loom project use ${d.name}\``,
    );
  },
});
