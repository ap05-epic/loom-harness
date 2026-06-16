import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  openCodeAtlas,
  repoMap,
  summarizeScreens,
  verifyScreenDocs,
  type JspForm,
  type SummarizeResult,
  type VerifyDocsResult,
} from '@loom/cartographer';
import { EXIT, notFoundError, usageError } from '../../errors.js';
import { gatewayFromProfile } from '../../pipeline-config.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';
import type { CliContext } from '../../context.js';

const ATLAS_OPT = { flags: '--atlas <path>', describe: 'path to codeatlas.db (else --data-dir)' };

function resolveAtlasPath(ctx: CliContext, optAtlas: unknown): string {
  const path =
    typeof optAtlas === 'string' && optAtlas
      ? optAtlas
      : ctx.flags.dataDir
        ? join(ctx.flags.dataDir, 'codeatlas.db')
        : undefined;
  if (!path) throw usageError('no atlas path', 'pass --atlas <path> or --data-dir');
  if (!existsSync(path)) throw notFoundError('atlas', path, 'run `loom map` first');
  return path;
}

export const atlasRepomapCommand = defineCommand({
  name: 'atlas repomap',
  group: 'knowledge',
  describe: 'Print the PageRank repo-map — a compact, whole-app overview of every screen',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  options: [
    ATLAS_OPT,
    { flags: '--project <name>', describe: 'heading project name (default: app)' },
  ],
  examples: ['loom atlas repomap --data-dir ./.loom-data', 'loom atlas repomap --json'],
  run(ctx, input) {
    const atlas = openCodeAtlas(resolveAtlasPath(ctx, input.options.atlas));
    try {
      const project = (input.options.project as string | undefined) ?? 'app';
      return { repoMap: repoMap(atlas, { project }) };
    } finally {
      atlas.close();
    }
  },
  render(data, ctx) {
    ctx.sink.line((data as { repoMap: string }).repoMap.trimEnd());
  },
});

type SliceData = {
  screen: string;
  action: string;
  formBean: string | null;
  jsps: string[];
  forms: JspForm[];
  taglibs: string[];
};

export const atlasSliceCommand = defineCommand({
  name: 'atlas slice',
  group: 'knowledge',
  describe: 'Show one screen’s slice: action, form bean, view JSPs, forms, taglibs',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  args: [{ name: 'screen', describe: 'screen key, e.g. login', required: true }],
  options: [ATLAS_OPT],
  examples: ['loom atlas slice login --data-dir ./.loom-data'],
  run(ctx, input) {
    const atlas = openCodeAtlas(resolveAtlasPath(ctx, input.options.atlas));
    try {
      const key = input.args.screen as string;
      const slice = atlas.sliceForScreen(key);
      if (!slice) throw notFoundError('screen', key, 'run `loom atlas repomap` to list screens');
      return {
        screen: key,
        action: slice.action.name,
        formBean: (slice.formBean?.meta as { type?: string } | undefined)?.type ?? null,
        jsps: slice.jsps.map((j) => j.name),
        forms: slice.forms,
        taglibs: slice.taglibs,
      } satisfies SliceData;
    } finally {
      atlas.close();
    }
  },
  render(data, ctx) {
    const d = data as SliceData;
    ctx.sink.line(`screen ${d.screen} → ${d.action}${d.formBean ? ` (form ${d.formBean})` : ''}`);
    ctx.sink.line(`views: ${d.jsps.join(', ') || '-'}`);
    ctx.sink.line(`taglibs: ${d.taglibs.join(', ') || '-'}`);
    if (d.forms.length) {
      ctx.sink.line('');
      ctx.sink.line(
        renderTable(
          d.forms.map((f) => ({
            action: f.action,
            method: f.method,
            fields: f.fields.map((x) => x.property).join(', '),
          })),
          [
            { key: 'action', header: 'FORM ACTION' },
            { key: 'method', header: 'METHOD' },
            { key: 'fields', header: 'FIELDS' },
          ],
        ),
      );
    }
  },
});

export const atlasFindCommand = defineCommand({
  name: 'atlas find',
  group: 'knowledge',
  describe: 'Search the atlas for nodes by name or kind (FTS5, BM25-ranked)',
  exitCodes: ['USAGE', 'NOT_FOUND'],
  args: [{ name: 'term', describe: 'search term', required: true }],
  options: [ATLAS_OPT, { flags: '--limit <n>', describe: 'max results (default 20)' }],
  examples: ['loom atlas find login --data-dir ./.loom-data', 'loom atlas find deal --json'],
  run(ctx, input) {
    const atlas = openCodeAtlas(resolveAtlasPath(ctx, input.options.atlas));
    try {
      const limit = input.options.limit !== undefined ? Number(input.options.limit) : 20;
      const results = atlas
        .search(input.args.term as string, { limit })
        .map((n) => ({ kind: n.kind, name: n.name }));
      return { term: input.args.term, results };
    } finally {
      atlas.close();
    }
  },
  render(data, ctx) {
    const d = data as { results: { kind: string; name: string }[] };
    if (d.results.length === 0) {
      ctx.sink.line('no matches');
      return;
    }
    ctx.sink.line(
      renderTable(d.results, [
        { key: 'kind', header: 'KIND' },
        { key: 'name', header: 'NAME' },
      ]),
    );
  },
});

export const atlasSummarizeCommand = defineCommand({
  name: 'atlas summarize',
  group: 'knowledge',
  describe: 'Generate the missing documentation — an LLM summary per screen, stored in the atlas',
  exitCodes: ['CONFIG', 'NETWORK', 'NOT_FOUND', 'USAGE'],
  options: [ATLAS_OPT, { flags: '--model <id>', describe: 'override the summarizer model' }],
  examples: ['loom atlas summarize --data-dir ./.loom-data'],
  async run(ctx, input) {
    const profile = ctx.requireProfile();
    const gateway = gatewayFromProfile(profile);
    const atlas = openCodeAtlas(resolveAtlasPath(ctx, input.options.atlas));
    try {
      const model = (input.options.model as string | undefined) ?? profile.llm.model;
      return await summarizeScreens(atlas, { gateway, model });
    } finally {
      atlas.close();
    }
  },
  render(data, ctx) {
    const d = data as SummarizeResult;
    ctx.sink.line(
      `summarized ${d.screensSummarized} screen(s) (${d.inputTokens}+${d.outputTokens} tokens)`,
    );
  },
});

export const atlasVerifyDocsCommand = defineCommand({
  name: 'atlas verify-docs',
  group: 'knowledge',
  describe:
    'Adversarially verify the recovered docs with a consensus panel; flags ones the source doesn’t support',
  exitCodes: ['CONFIG', 'NETWORK', 'NOT_FOUND', 'USAGE', 'BLOCKED'],
  options: [
    ATLAS_OPT,
    { flags: '--model <id>', describe: 'override the judge model' },
    { flags: '--judges <n>', describe: 'judges per doc (default 3)' },
  ],
  examples: ['loom atlas verify-docs --data-dir ./.loom-data', 'loom atlas verify-docs --json'],
  async run(ctx, input) {
    const profile = ctx.requireProfile();
    const gateway = gatewayFromProfile(profile);
    const atlas = openCodeAtlas(resolveAtlasPath(ctx, input.options.atlas));
    try {
      const model = (input.options.model as string | undefined) ?? profile.llm.model;
      const judges = input.options.judges !== undefined ? Number(input.options.judges) : undefined;
      const result = await verifyScreenDocs(atlas, { gateway, model, judges });
      // A flagged doc is a soft failure — surface it via exit BLOCKED so a CI/shift gate can branch.
      if (result.flagged.length > 0) ctx.requestExit(EXIT.BLOCKED);
      return result;
    } finally {
      atlas.close();
    }
  },
  render(data, ctx) {
    const d = data as VerifyDocsResult;
    if (d.flagged.length === 0) {
      ctx.sink.line(`verified ${d.verified} recovered doc(s) — none flagged.`);
      return;
    }
    ctx.sink.line(
      `verified ${d.verified} doc(s); ${d.flagged.length} flagged as unsupported by the source:`,
    );
    for (const f of d.flagged) {
      ctx.sink.line(
        `  ✗ ${f.screenKey} (${f.votes.ok}/${f.votes.total} approved) — ${f.reasons[0] ?? ''}`,
      );
    }
  },
});
