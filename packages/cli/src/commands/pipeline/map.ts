import { existsSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { discoverLegacyWebapp, mapProject } from '@loom/cartographer';
import { configError, notFoundError } from '../../errors.js';
import { defineCommand } from '../../registry.js';
import { renderTable } from '../../ui/table.js';
import type { CliContext } from '../../context.js';

type MapData = {
  atlas: string;
  screens: Array<{ key: string; actionPath: string; formBean: string | null; viewJsps: string[] }>;
  tiles: number;
  jsps: number;
};

/** Resolve the struts-config + atlas paths from flags, falling back to the profile. */
function resolvePaths(
  ctx: CliContext,
  opts: Record<string, unknown>,
): { struts: string; atlas: string } {
  let struts = opts.struts as string | undefined;
  let atlas = opts.atlas as string | undefined;
  if (struts && atlas) return { struts, atlas };

  const p = ctx.requireProfile();
  if (!struts) {
    if (!p.source?.strutsConfig) {
      throw configError(
        'no source.strutsConfig in the profile and no --struts given',
        'add `source.strutsConfig:` to harness.config.yaml or pass --struts <path>',
      );
    }
    struts = isAbsolute(p.source.strutsConfig)
      ? p.source.strutsConfig
      : join(p.dir, p.source.strutsConfig);
  }
  if (!atlas) {
    if (!p.dataDir) {
      throw configError(
        'no data dir resolved and no --atlas given',
        'pass --data-dir <dir> or --atlas <path>',
      );
    }
    atlas = join(p.dataDir, 'codeatlas.db');
  }
  return { struts, atlas };
}

export const mapCommand = defineCommand({
  name: 'map',
  group: 'pipeline',
  describe: 'Parse the legacy Struts config into a CodeAtlas (the MAP stage)',
  exitCodes: ['CONFIG', 'NOT_FOUND', 'RUNTIME'],
  options: [
    { flags: '--struts <path>', describe: 'path to struts-config.xml (overrides the profile)' },
    { flags: '--atlas <path>', describe: 'path to write codeatlas.db (overrides the data dir)' },
  ],
  examples: [
    'loom map',
    'loom map --struts ./legacy/WEB-INF/struts-config.xml --atlas ./out/codeatlas.db --json',
  ],
  run(ctx, input) {
    const { struts, atlas } = resolvePaths(ctx, input.options);
    if (!existsSync(struts)) {
      throw notFoundError('struts-config', struts, 'check source.strutsConfig or --struts');
    }
    // Fresh MAP: drop any prior atlas so re-mapping never double-ingests nodes.
    for (const suffix of ['', '-wal', '-shm']) {
      const f = atlas + suffix;
      if (existsSync(f)) rmSync(f);
    }
    // Auto-discover the sibling Tiles/web.xml + JSPs so one command builds the
    // full enriched atlas, not just the struts action graph.
    const discovered = discoverLegacyWebapp(struts);
    const codeAtlas = mapProject({
      strutsConfigPath: struts,
      atlasPath: atlas,
      tilesDefsPath: discovered.tilesDefsPath,
      webXmlPath: discovered.webXmlPath,
      jsps: discovered.jsps,
    });
    try {
      const screens = codeAtlas.screens().map((s) => ({
        key: s.key,
        actionPath: s.actionPath,
        formBean: s.formBean,
        viewJsps: s.viewJsps,
      }));
      return {
        atlas,
        screens,
        tiles: codeAtlas.nodesByKind('tile_def').length,
        jsps: codeAtlas.nodesByKind('jsp').length,
      } satisfies MapData;
    } finally {
      codeAtlas.close();
    }
  },
  render(data, ctx) {
    const d = data as MapData;
    ctx.sink.line(
      renderTable(
        d.screens.map((s) => ({
          key: s.key,
          actionPath: s.actionPath,
          form: s.formBean ?? '-',
          views: s.viewJsps.join(', ') || '-',
        })),
        [
          { key: 'key', header: 'SCREEN' },
          { key: 'actionPath', header: 'ACTION' },
          { key: 'form', header: 'FORM BEAN' },
          { key: 'views', header: 'VIEW JSP(S)' },
        ],
      ),
    );
    ctx.sink.line('');
    ctx.sink.line(
      `${d.screens.length} screen(s), ${d.tiles} tile layout(s), ${d.jsps} JSP(s) → ${d.atlas}`,
    );
  },
});
