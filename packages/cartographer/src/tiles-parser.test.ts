import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parseTilesDefs } from './tiles-parser.js';

const TILES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
  'WEB-INF',
  'tiles-defs.xml',
);

describe('parseTilesDefs', () => {
  test('recovers every definition', () => {
    const { definitions } = parseTilesDefs(readFileSync(TILES, 'utf8'));
    expect(definitions.map((d) => d.name).sort()).toEqual([
      'example.layout.main',
      'example.list',
      'example.wizard.entity',
      'example.wizard.parameters',
      'example.wizard.review',
    ]);
  });

  test('captures the base layout path and its put-attributes', () => {
    const { definitions } = parseTilesDefs(readFileSync(TILES, 'utf8'));
    const main = definitions.find((d) => d.name === 'example.layout.main')!;
    expect(main.path).toBe('/jsp/layout.jsp');
    expect(main.extends).toBeUndefined();
    const byName = Object.fromEntries(main.attributes.map((a) => [a.name, a.value]));
    expect(byName.header).toBe('/jsp/fragments/header.jsp');
    expect(byName.footer).toBe('/jsp/fragments/footer.jsp');
  });

  test('captures extends + the body JSP of a derived definition', () => {
    const { definitions } = parseTilesDefs(readFileSync(TILES, 'utf8'));
    const list = definitions.find((d) => d.name === 'example.list')!;
    expect(list.extends).toBe('example.layout.main');
    expect(list.path).toBeUndefined();
    const body = list.attributes.find((a) => a.name === 'body');
    expect(body?.value).toBe('/jsp/list.jsp');
  });

  test('an empty config parses to no definitions', () => {
    expect(parseTilesDefs('<tiles-definitions></tiles-definitions>').definitions).toEqual([]);
  });
});
