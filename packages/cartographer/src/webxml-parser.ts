import { XMLParser } from 'fast-xml-parser';

export type WebServlet = { name: string; className: string; urlPatterns: string[] };
export type WebFilter = { name: string; className: string; urlPatterns: string[] };
export type WebXml = { servlets: WebServlet[]; filters: WebFilter[] };

const parser = new XMLParser({ ignoreAttributes: true });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

type Node = Record<string, unknown>;
const text = (node: Node, name: string): string | undefined => {
  const v = node[name];
  return v === undefined || v === null ? undefined : String(v);
};

/** Build a name → url-patterns map from `<servlet-mapping>` / `<filter-mapping>` nodes. */
function mappings(nodes: Node[], nameKey: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of nodes) {
    const name = text(m, nameKey);
    if (!name) continue;
    const patterns = asArray<unknown>(m['url-pattern'] as unknown).map((p) => String(p));
    out.set(name, [...(out.get(name) ?? []), ...patterns]);
  }
  return out;
}

/** Parse a Java EE `web.xml` into servlets/filters with their URL mappings (pure). */
export function parseWebXml(xml: string): WebXml {
  const root = (parser.parse(xml) as Record<string, Node>)['web-app'] ?? {};

  const servletMap = mappings(
    asArray<Node>(root['servlet-mapping'] as Node | Node[] | undefined),
    'servlet-name',
  );
  const servlets = asArray<Node>(root['servlet'] as Node | Node[] | undefined).map((s) => {
    const name = text(s, 'servlet-name') ?? '';
    return {
      name,
      className: text(s, 'servlet-class') ?? '',
      urlPatterns: servletMap.get(name) ?? [],
    };
  });

  const filterMap = mappings(
    asArray<Node>(root['filter-mapping'] as Node | Node[] | undefined),
    'filter-name',
  );
  const filters = asArray<Node>(root['filter'] as Node | Node[] | undefined).map((f) => {
    const name = text(f, 'filter-name') ?? '';
    return {
      name,
      className: text(f, 'filter-class') ?? '',
      urlPatterns: filterMap.get(name) ?? [],
    };
  });

  return { servlets, filters };
}
