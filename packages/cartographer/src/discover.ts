import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** A struts config plus the sibling Tiles/web.xml and JSP files discovered next to it. */
export type DiscoveredWebapp = {
  strutsConfigPath: string;
  tilesDefsPath?: string;
  webXmlPath?: string;
  /** Each JSP as its logical webapp path (e.g. `/jsp/login.jsp`) + file on disk. */
  jsps: { path: string; file: string }[];
};

/** Recursively collect files matching a predicate under a directory. */
function walk(dir: string, match: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (match(full)) out.push(full);
  }
  return out;
}

/**
 * Given a `struts-config.xml` path, find the legacy webapp's other source: the
 * sibling `tiles-defs.xml` / `web.xml` in the same WEB-INF, and every `*.jsp`
 * under the webapp root (WEB-INF's parent), keyed by its logical path. Lets a
 * single `loom map` build the full enriched atlas from one config path.
 */
export function discoverLegacyWebapp(strutsConfigPath: string): DiscoveredWebapp {
  const webInf = dirname(strutsConfigPath);
  const webappRoot = dirname(webInf);
  const tilesDefsPath = join(webInf, 'tiles-defs.xml');
  const webXmlPath = join(webInf, 'web.xml');

  const jsps = walk(webappRoot, (f) => f.toLowerCase().endsWith('.jsp')).map((file) => ({
    path: '/' + relative(webappRoot, file).split(sep).join('/'),
    file,
  }));

  return {
    strutsConfigPath,
    tilesDefsPath: existsSync(tilesDefsPath) ? tilesDefsPath : undefined,
    webXmlPath: existsSync(webXmlPath) ? webXmlPath : undefined,
    jsps,
  };
}
