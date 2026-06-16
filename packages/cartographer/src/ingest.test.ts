import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openCodeAtlas, type CodeAtlas } from './codeatlas.js';
import { ingestLegacyWebapp, type LegacySources } from './map.js';
import { parseStrutsConfig } from './struts-parser.js';
import { parseTilesDefs } from './tiles-parser.js';
import { parseWebXml } from './webxml-parser.js';
import { parseJsp } from './jsp-parser.js';

const LEGACY_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
);

function sources(): LegacySources {
  const webInf = join(LEGACY_SRC, 'WEB-INF');
  const read = (p: string) => readFileSync(join(LEGACY_SRC, p), 'utf8');
  const jspFiles = [
    'jsp/layout.jsp',
    'jsp/login.jsp',
    'jsp/list.jsp',
    'jsp/fragments/header.jsp',
    'jsp/fragments/footer.jsp',
  ];
  return {
    struts: parseStrutsConfig(readFileSync(join(webInf, 'struts-config.xml'), 'utf8')),
    tiles: parseTilesDefs(readFileSync(join(webInf, 'tiles-defs.xml'), 'utf8')),
    web: parseWebXml(readFileSync(join(webInf, 'web.xml'), 'utf8')),
    jsps: jspFiles.map((rel) => ({ path: `/${rel}`, info: parseJsp(read(rel)) })),
  };
}

let dir: string;
let atlas: CodeAtlas;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ingest-'));
  atlas = openCodeAtlas(join(dir, 'codeatlas.db'));
  ingestLegacyWebapp(atlas, sources());
});
afterEach(() => {
  atlas.close();
  rmSync(dir, { recursive: true, force: true });
});

const linkedNames = (kind: string, name: string, edge: string): string[] =>
  atlas.linked(atlas.findNode(kind, name)!.id, edge).map((n) => n.name);

describe('ingestLegacyWebapp — Tiles composition', () => {
  test('records every tile definition', () => {
    expect(atlas.nodesByKind('tile_def').map((n) => n.name)).toContain('example.layout.main');
    expect(atlas.nodesByKind('tile_def')).toHaveLength(5);
  });

  test('a derived definition extends its parent layout', () => {
    expect(linkedNames('tile_def', 'example.list', 'extends_tile')).toEqual([
      'example.layout.main',
    ]);
  });

  test('the base layout renders its layout JSP and header/footer fragments', () => {
    const rendered = linkedNames('tile_def', 'example.layout.main', 'renders');
    expect(rendered).toContain('/jsp/layout.jsp');
    expect(rendered).toContain('/jsp/fragments/header.jsp');
    expect(rendered).toContain('/jsp/fragments/footer.jsp');
  });
});

describe('ingestLegacyWebapp — web.xml', () => {
  test('records the Struts servlet with its url-pattern in meta', () => {
    const servlet = atlas.findNode('servlet', 'action')!;
    expect(servlet.meta).toMatchObject({
      className: 'org.apache.struts.action.ActionServlet',
      urlPatterns: ['*.do'],
    });
  });

  test('records the authentication filter', () => {
    expect(atlas.findNode('filter', 'authFilter')).not.toBeNull();
  });
});

describe('ingestLegacyWebapp — JSP enrichment', () => {
  test('attaches parsed forms (with fields) to the JSP node', () => {
    const login = atlas.findNode('jsp', '/jsp/login.jsp')!;
    const meta = login.meta as {
      forms: Array<{ action: string; fields: Array<{ property: string }> }>;
    };
    expect(meta.forms[0]!.action).toBe('/login');
    expect(meta.forms[0]!.fields.map((f) => f.property)).toEqual(['username', 'password']);
  });

  test('links each JSP to the taglibs it declares', () => {
    const taglibs = linkedNames('jsp', '/jsp/list.jsp', 'uses_taglib');
    expect(taglibs).toContain('http://struts.apache.org/tags-html');
    expect(taglibs).toHaveLength(5);
  });

  test('records JSP navigation links to actions', () => {
    expect(linkedNames('jsp', '/jsp/fragments/header.jsp', 'links_to').sort()).toEqual([
      '/list',
      '/logout',
      '/wizard',
    ]);
  });

  test('records a form submit target as an edge to its action', () => {
    expect(linkedNames('jsp', '/jsp/login.jsp', 'submits_to')).toContain('/login');
  });
});

describe('ingestLegacyWebapp — enriched slice', () => {
  test('sliceForScreen surfaces the screen forms and taglibs', () => {
    const slice = atlas.sliceForScreen('login')!;
    expect(slice.forms[0]!.fields.map((f) => f.property)).toEqual(['username', 'password']);
    expect(slice.taglibs).toContain('html');
  });
});

describe('ingestLegacyWebapp — idempotent', () => {
  test('re-ingesting the same sources does not duplicate nodes', () => {
    ingestLegacyWebapp(atlas, sources());
    expect(atlas.nodesByKind('tile_def')).toHaveLength(5);
    expect(atlas.nodesByKind('servlet')).toHaveLength(1);
    expect(atlas.nodesByKind('action')).toHaveLength(5);
  });
});
