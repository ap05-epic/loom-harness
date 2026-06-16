import { isAbsolute, join } from 'node:path';
import { copySkillDir, loadSkillDir, writeSkillFile } from '@loom/skills';
import type { Profile } from '@loom/core';
import { configError, notFoundError, usageError } from '../../errors.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';

type SkillRow = { name: string; description: string; triggers: string };

/** The project's SKILL.md library directory (profile `skills.dir`, resolved against the profile dir). */
function projectSkillsDir(profile: Profile): string | undefined {
  const dir = profile.skills?.dir;
  return dir ? (isAbsolute(dir) ? dir : join(profile.dir, dir)) : undefined;
}

/** Export/import targets we can round-trip today. Our SKILL.md *is* the agentskills.io/DIGIT shape. */
const SUPPORTED_TARGETS = ['digit'] as const;

export const skillsListCommand = defineCommand({
  name: 'skills list',
  group: 'knowledge',
  describe: 'List the SKILL.md skills available to the project (from skills.dir)',
  exitCodes: ['CONFIG'],
  examples: ['loom skills list', 'loom skills list --json'],
  run(ctx) {
    const profile = ctx.requireProfile();
    const resolved = projectSkillsDir(profile);
    const skills: SkillRow[] = resolved
      ? loadSkillDir(resolved).map((s) => ({
          name: s.name,
          description: s.description,
          triggers: s.triggers.join(', '),
        }))
      : [];
    return { dir: resolved ?? null, skills };
  },
  render(data, ctx) {
    const d = data as { dir: string | null; skills: SkillRow[] };
    if (d.skills.length === 0) {
      ctx.sink.line(
        d.dir
          ? `No SKILL.md files under ${d.dir}.`
          : 'No skills.dir configured — add a `skills.dir:` to loom.config.yaml.',
      );
      return;
    }
    ctx.sink.line(
      renderTable(d.skills, [
        { key: 'name', header: 'NAME' },
        { key: 'description', header: 'DESCRIPTION' },
        { key: 'triggers', header: 'TRIGGERS' },
      ]),
    );
  },
});

export const skillsShowCommand = defineCommand({
  name: 'skills show',
  group: 'knowledge',
  describe: 'Show one skill in full (description, triggers, procedure body)',
  exitCodes: ['CONFIG', 'NOT_FOUND'],
  args: [
    { name: 'name', describe: 'skill name (as listed by `loom skills list`)', required: true },
  ],
  examples: ['loom skills show tiles-layout', 'loom skills show iterate-table --json'],
  run(ctx, input) {
    const profile = ctx.requireProfile();
    const dir = projectSkillsDir(profile);
    const name = input.args.name as string;
    const skill = dir ? loadSkillDir(dir).find((s) => s.name === name) : undefined;
    if (!skill)
      throw notFoundError('skill', name, 'run `loom skills list` to see what’s available');
    return skill;
  },
  render(data, ctx) {
    const d = data as { name: string; description: string; triggers: string[]; body: string };
    ctx.sink.line(`# ${d.name}`);
    ctx.sink.line(d.description);
    if (d.triggers.length) ctx.sink.line(`triggers: ${d.triggers.join(', ')}`);
    ctx.sink.line('');
    ctx.sink.line(d.body);
  },
});

export const skillsNewCommand = defineCommand({
  name: 'skills new',
  group: 'knowledge',
  describe: 'Author a new SKILL.md in the project library (human-written, active immediately)',
  exitCodes: ['CONFIG', 'USAGE'],
  options: [
    { flags: '--name <name>', describe: 'skill name, kebab-case (required)' },
    { flags: '--description <text>', describe: 'one-line description (drives recall ranking)' },
    { flags: '--triggers <list>', describe: 'comma-separated trigger terms' },
    { flags: '--body <text>', describe: 'the procedure body' },
    { flags: '--dir <dir>', describe: 'skills dir (default: the profile’s skills.dir)' },
  ],
  examples: [
    'loom skills new --name tiles-to-layout --description "Tiles layout → React" --triggers tiles,layout',
  ],
  run(ctx, input) {
    const profile = ctx.requireProfile();
    const name = input.options.name as string | undefined;
    if (!name) throw usageError('no --name', 'pass --name <kebab-case-name>');
    const dir = (input.options.dir as string | undefined) ?? projectSkillsDir(profile);
    if (!dir) {
      throw configError(
        'no skills directory',
        'add a `skills.dir:` to loom.config.yaml, or pass --dir <dir>',
      );
    }
    const triggers =
      typeof input.options.triggers === 'string'
        ? input.options.triggers
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
    const path = writeSkillFile(dir, {
      name,
      description: (input.options.description as string | undefined) ?? '',
      triggers,
      body: (input.options.body as string | undefined) ?? '',
    });
    return { name, path };
  },
  render(data, ctx) {
    const d = data as { name: string; path: string };
    ctx.sink.line(`wrote skill "${d.name}" → ${d.path}`);
  },
});

export const skillsExportCommand = defineCommand({
  name: 'skills export',
  group: 'knowledge',
  describe: 'Export the project’s SKILL.md library to a directory (DIGIT-compatible interop)',
  exitCodes: ['CONFIG', 'USAGE'],
  options: [
    { flags: '--out <dir>', describe: 'destination directory (e.g. ~/.copilot/skills for DIGIT)' },
    { flags: '--target <fmt>', describe: 'export format (default: digit)' },
    { flags: '--from <dir>', describe: 'source skills dir (default: the profile’s skills.dir)' },
  ],
  examples: [
    'loom skills export --target digit --out ~/.copilot/skills',
    'loom skills export --out ./shared-skills --json',
  ],
  run(ctx, input) {
    const profile = ctx.requireProfile();
    const target = (input.options.target as string | undefined) ?? 'digit';
    if (!SUPPORTED_TARGETS.includes(target as (typeof SUPPORTED_TARGETS)[number])) {
      throw usageError(
        `unsupported export target: ${target}`,
        `supported targets: ${SUPPORTED_TARGETS.join(', ')}`,
      );
    }
    const out = input.options.out as string | undefined;
    if (!out) throw usageError('no --out directory', 'pass --out <dir> (e.g. ~/.copilot/skills)');
    const from = (input.options.from as string | undefined) ?? projectSkillsDir(profile);
    if (!from) {
      throw configError(
        'no source skills directory',
        'add a `skills.dir:` to loom.config.yaml, or pass --from <dir>',
      );
    }
    return { target, from, out, exported: copySkillDir(from, out) };
  },
  render(data, ctx) {
    const d = data as { target: string; out: string; exported: string[] };
    ctx.sink.line(
      d.exported.length
        ? `exported ${d.exported.length} skill(s) to ${d.out} (${d.target}): ${d.exported.join(', ')}`
        : 'no skills to export (the source directory had none).',
    );
  },
});

export const skillsImportCommand = defineCommand({
  name: 'skills import',
  group: 'knowledge',
  describe: 'Import external SKILL.md files into the project’s skill library',
  exitCodes: ['CONFIG', 'USAGE'],
  options: [
    {
      flags: '--from <dir>',
      describe: 'source directory of SKILL.md files (e.g. ~/.copilot/skills)',
    },
    {
      flags: '--out <dir>',
      describe: 'destination skills dir (default: the profile’s skills.dir)',
    },
  ],
  examples: ['loom skills import --from ~/.copilot/skills', 'loom skills import --from ./shared'],
  run(ctx, input) {
    const profile = ctx.requireProfile();
    const from = input.options.from as string | undefined;
    if (!from) throw usageError('no --from directory', 'pass --from <dir> of SKILL.md files');
    const out = (input.options.out as string | undefined) ?? projectSkillsDir(profile);
    if (!out) {
      throw configError(
        'no destination skills directory',
        'add a `skills.dir:` to loom.config.yaml, or pass --out <dir>',
      );
    }
    return { from, out, imported: copySkillDir(from, out) };
  },
  render(data, ctx) {
    const d = data as { out: string; imported: string[] };
    ctx.sink.line(
      d.imported.length
        ? `imported ${d.imported.length} skill(s) into ${d.out}: ${d.imported.join(', ')}`
        : 'no SKILL.md files found to import.',
    );
  },
});
