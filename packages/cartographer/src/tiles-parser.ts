import { XMLParser } from 'fast-xml-parser';

export type TileAttribute = { name: string; value: string };
export type TileDefinition = {
  name: string;
  /** The layout JSP this definition renders (base definitions). */
  path?: string;
  /** The parent definition this one extends (derived definitions). */
  extends?: string;
  attributes: TileAttribute[];
};
export type TilesConfig = { definitions: TileDefinition[] };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

type AttrNode = Record<string, unknown>;
const attr = (node: AttrNode, name: string): string | undefined => {
  const v = node[`@_${name}`];
  return v === undefined ? undefined : String(v);
};

/** Parse a Struts/Tiles `tiles-defs.xml` into the layout composition model (pure). */
export function parseTilesDefs(xml: string): TilesConfig {
  const root = (parser.parse(xml) as Record<string, AttrNode>)['tiles-definitions'] ?? {};
  const definitions = asArray<AttrNode>(
    root['definition'] as AttrNode | AttrNode[] | undefined,
  ).map((d) => {
    const attributes = asArray<AttrNode>(d['put-attribute'] as AttrNode | AttrNode[] | undefined)
      .map((p) => ({ name: attr(p, 'name') ?? '', value: attr(p, 'value') ?? '' }))
      .filter((a) => a.name !== '');
    return {
      name: attr(d, 'name') ?? '',
      path: attr(d, 'path'),
      extends: attr(d, 'extends'),
      attributes,
    };
  });
  return { definitions };
}
