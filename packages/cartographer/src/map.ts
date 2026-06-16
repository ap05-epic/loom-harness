import { readFileSync } from 'node:fs';
import { openCodeAtlas, type CodeAtlas } from './codeatlas.js';
import { parseStrutsConfig, type StrutsConfig } from './struts-parser.js';
import { parseTilesDefs, type TilesConfig } from './tiles-parser.js';
import { parseWebXml, type WebXml } from './webxml-parser.js';
import { parseJsp, type JspInfo } from './jsp-parser.js';

/** Write the screen graph from a parsed Struts config into a CodeAtlas (idempotent). */
export function ingestStrutsConfig(atlas: CodeAtlas, config: StrutsConfig): void {
  const formBeanId = new Map<string, number>();
  for (const fb of config.formBeans) {
    formBeanId.set(fb.name, atlas.ensureNode('form_bean', fb.name, undefined, { type: fb.type }));
  }

  for (const action of config.actions) {
    const actionId = atlas.ensureNode('action', action.path);
    atlas.setNodeMeta(actionId, {
      type: action.type ?? null,
      formName: action.name ?? null,
      input: action.input ?? null,
    });

    if (action.name && formBeanId.has(action.name)) {
      atlas.addEdge(actionId, formBeanId.get(action.name)!, 'uses_form');
    }

    const jspPaths = new Set<string>();
    if (action.input?.endsWith('.jsp')) jspPaths.add(action.input);
    for (const f of action.forwards) if (f.path.endsWith('.jsp')) jspPaths.add(f.path);
    for (const jsp of jspPaths) {
      atlas.addEdge(actionId, atlas.ensureNode('jsp', jsp), 'renders');
    }

    // forwards to other actions (.do) become forwards_to edges (best-effort)
    for (const f of action.forwards) {
      if (f.path.endsWith('.do')) {
        atlas.addEdge(actionId, atlas.ensureNode('action_ref', f.path), 'forwards_to', {
          redirect: f.redirect,
        });
      }
    }
  }
}

/** Add the Tiles layout composition (definitions, extends, the JSPs they render). */
export function ingestTiles(atlas: CodeAtlas, tiles: TilesConfig): void {
  for (const def of tiles.definitions) {
    const id = atlas.ensureNode('tile_def', def.name);
    atlas.setNodeMeta(id, { path: def.path ?? null, extends: def.extends ?? null });
    if (def.extends) {
      atlas.addEdge(id, atlas.ensureNode('tile_def', def.extends), 'extends_tile');
    }
    const jsps = new Set<string>();
    if (def.path?.endsWith('.jsp')) jsps.add(def.path);
    for (const a of def.attributes) if (a.value.endsWith('.jsp')) jsps.add(a.value);
    for (const jsp of jsps) atlas.addEdge(id, atlas.ensureNode('jsp', jsp), 'renders');
  }
}

/** Add the deployment descriptor's servlets + filters (with their url-patterns). */
export function ingestWebXml(atlas: CodeAtlas, web: WebXml): void {
  for (const s of web.servlets) {
    const id = atlas.ensureNode('servlet', s.name);
    atlas.setNodeMeta(id, { className: s.className, urlPatterns: s.urlPatterns });
  }
  for (const f of web.filters) {
    const id = atlas.ensureNode('filter', f.name);
    atlas.setNodeMeta(id, { className: f.className, urlPatterns: f.urlPatterns });
  }
}

/** A parsed JSP plus its logical path (e.g. `/jsp/login.jsp`). */
export type LegacyJsp = { path: string; info: JspInfo };

/** Enrich a JSP node with its parsed forms + wire taglib/include/nav edges. */
export function ingestJsp(atlas: CodeAtlas, jsp: LegacyJsp): void {
  const id = atlas.ensureNode('jsp', jsp.path);
  atlas.setNodeMeta(id, {
    forms: jsp.info.forms,
    iterations: jsp.info.iterations,
    taglibs: jsp.info.taglibs.map((t) => t.prefix),
  });
  for (const t of jsp.info.taglibs) {
    const tid = atlas.ensureNode('taglib', t.uri);
    atlas.setNodeMeta(tid, { prefix: t.prefix });
    atlas.addEdge(id, tid, 'uses_taglib');
  }
  for (const inc of jsp.info.includes) {
    atlas.addEdge(id, atlas.ensureNode('jsp', inc), 'includes');
  }
  for (const action of new Set(jsp.info.links)) {
    atlas.addEdge(id, atlas.ensureNode('action', action), 'links_to');
  }
  for (const form of jsp.info.forms) {
    atlas.addEdge(id, atlas.ensureNode('action', form.action), 'submits_to');
  }
}

/** Everything the cartographer parses from a legacy webapp's source. */
export type LegacySources = {
  struts: StrutsConfig;
  tiles?: TilesConfig;
  web?: WebXml;
  jsps?: LegacyJsp[];
};

/** Ingest a fully-parsed legacy webapp into the atlas — Struts + Tiles + web.xml + JSPs. */
export function ingestLegacyWebapp(atlas: CodeAtlas, sources: LegacySources): void {
  ingestStrutsConfig(atlas, sources.struts);
  if (sources.tiles) ingestTiles(atlas, sources.tiles);
  if (sources.web) ingestWebXml(atlas, sources.web);
  for (const jsp of sources.jsps ?? []) ingestJsp(atlas, jsp);
}

export type MapProjectOptions = {
  /** Path to the legacy struts-config.xml. */
  strutsConfigPath: string;
  /** Path to write the CodeAtlas SQLite file. */
  atlasPath: string;
  /** Optional Tiles definitions to deepen the layout graph. */
  tilesDefsPath?: string;
  /** Optional web.xml for servlets/filters. */
  webXmlPath?: string;
  /** Optional JSPs to parse, as `{ path, file }` (logical path + file on disk). */
  jsps?: { path: string; file: string }[];
};

/** MAP stage: parse the legacy source into a CodeAtlas on disk. */
export function mapProject(options: MapProjectOptions): CodeAtlas {
  const atlas = openCodeAtlas(options.atlasPath);
  const sources: LegacySources = {
    struts: parseStrutsConfig(readFileSync(options.strutsConfigPath, 'utf8')),
  };
  if (options.tilesDefsPath) {
    sources.tiles = parseTilesDefs(readFileSync(options.tilesDefsPath, 'utf8'));
  }
  if (options.webXmlPath) {
    sources.web = parseWebXml(readFileSync(options.webXmlPath, 'utf8'));
  }
  if (options.jsps) {
    sources.jsps = options.jsps.map((j) => ({
      path: j.path,
      info: parseJsp(readFileSync(j.file, 'utf8')),
    }));
  }
  ingestLegacyWebapp(atlas, sources);
  return atlas;
}
