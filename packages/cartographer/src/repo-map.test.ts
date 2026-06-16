import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openCodeAtlas, type CodeAtlas } from './codeatlas.js';
import { ingestLegacyWebapp, type LegacySources } from './map.js';
import { repoMap } from './repo-map.js';
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
    struts: parseStrutsConfig(read('WEB-INF/struts-config.xml')),
    tiles: parseTilesDefs(read('WEB-INF/tiles-defs.xml')),
    web: parseWebXml(readFileSync(join(webInf, 'web.xml'), 'utf8')),
    jsps: jspFiles.map((rel) => ({ path: `/${rel}`, info: parseJsp(read(rel)) })),
  };
}

let dir: string;
let atlas: CodeAtlas;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'repomap-'));
  atlas = openCodeAtlas(join(dir, 'codeatlas.db'));
  ingestLegacyWebapp(atlas, sources());
});
afterEach(() => {
  atlas.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('repoMap', () => {
  test('names every screen', () => {
    const map = repoMap(atlas, { project: 'fixture' });
    for (const key of ['login', 'list', 'wizard', 'popup', 'logout']) {
      expect(map).toContain(key);
    }
  });

  test('includes each screen’s view JSP and form fields', () => {
    const map = repoMap(atlas, { project: 'fixture' });
    expect(map).toContain('/jsp/login.jsp');
    expect(map).toContain('username');
    expect(map).toContain('password');
  });

  test('stays within a compact token budget (≤ 8K tokens)', () => {
    const map = repoMap(atlas, { project: 'fixture' });
    // ~4 chars/token heuristic; the fixture map must be a cheap whole-codebase overview.
    expect(Math.ceil(map.length / 4)).toBeLessThanOrEqual(8000);
  });

  test('ranks the most-referenced screen above a leaf screen', () => {
    const map = repoMap(atlas, { project: 'fixture' });
    // /list is linked from the header nav, the login success forward, and the
    // wizard's done forward; /logout is a leaf. Importance ranking puts list first.
    expect(map.indexOf('list')).toBeLessThan(map.indexOf('logout'));
  });

  test('reports the project name and a screen count', () => {
    const map = repoMap(atlas, { project: 'fixture' });
    expect(map).toContain('fixture');
    expect(map).toMatch(/5 screens/);
  });

  test('surfaces a generated doc under its screen', () => {
    atlas.setNodeDoc(atlas.findNode('action', '/login')!.id, 'Signs analysts into the pipeline.');
    expect(repoMap(atlas, { project: 'fixture' })).toContain('Signs analysts into the pipeline.');
  });
});
