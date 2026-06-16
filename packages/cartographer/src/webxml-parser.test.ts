import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parseWebXml } from './webxml-parser.js';

const WEB_XML = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
  'WEB-INF',
  'web.xml',
);

describe('parseWebXml', () => {
  test('recovers the Struts front controller and its url-pattern', () => {
    const { servlets } = parseWebXml(readFileSync(WEB_XML, 'utf8'));
    expect(servlets).toHaveLength(1);
    expect(servlets[0]).toMatchObject({
      name: 'action',
      className: 'org.apache.struts.action.ActionServlet',
      urlPatterns: ['*.do'],
    });
  });

  test('recovers the authentication filter and its mapping', () => {
    const { filters } = parseWebXml(readFileSync(WEB_XML, 'utf8'));
    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatchObject({
      name: 'authFilter',
      className: 'com.example.legacy.web.filter.AuthenticationFilter',
      urlPatterns: ['*.do'],
    });
  });

  test('an empty web-app parses to no servlets or filters', () => {
    const empty = parseWebXml('<web-app></web-app>');
    expect(empty.servlets).toEqual([]);
    expect(empty.filters).toEqual([]);
  });
});
