import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { discoverLegacyWebapp } from './discover.js';

const STRUTS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
  'WEB-INF',
  'struts-config.xml',
);

describe('discoverLegacyWebapp', () => {
  test('finds the sibling tiles-defs.xml and web.xml', () => {
    const found = discoverLegacyWebapp(STRUTS);
    expect(found.tilesDefsPath?.replace(/\\/g, '/')).toMatch(/WEB-INF\/tiles-defs\.xml$/);
    expect(found.webXmlPath?.replace(/\\/g, '/')).toMatch(/WEB-INF\/web\.xml$/);
  });

  test('discovers every JSP with its logical webapp path', () => {
    const found = discoverLegacyWebapp(STRUTS);
    const paths = found.jsps.map((j) => j.path).sort();
    expect(paths).toEqual([
      '/jsp/fragments/footer.jsp',
      '/jsp/fragments/header.jsp',
      '/jsp/layout.jsp',
      '/jsp/list.jsp',
      '/jsp/login.jsp',
    ]);
    const login = found.jsps.find((j) => j.path === '/jsp/login.jsp')!;
    expect(login.file.replace(/\\/g, '/')).toMatch(/legacy-src\/jsp\/login\.jsp$/);
  });

  test('carries the struts config path through', () => {
    expect(discoverLegacyWebapp(STRUTS).strutsConfigPath).toBe(STRUTS);
  });
});
