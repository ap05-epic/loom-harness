import { saveWorkspace } from '@loom/core';
import { notFoundError } from '../../errors.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';
import { requireWorkspace, resolveProjectContext } from '../../workspace.js';

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
