import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/** The legacy context path from a URL (e.g. `http://host/BAA/jsp/x.jsp` → `BAA`). */
export function contextFromUrl(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
    return seg ?? '';
  } catch {
    return '';
  }
}

/**
 * Mirror the legacy webapp's STATIC assets (css, images, js, fonts — everything except WEB-INF and the
 * JSPs) into the React app's `public/<context>/`, so the real stylesheets/images resolve at the SAME
 * URLs the legacy `<link href="/BAA/css/…">` uses. Returns the list of copied CSS URLs (to link).
 * This is the "reuse, don't recreate" path: the React app loads the legacy CSS verbatim.
 */
export function reuseLegacyAssets(opts: {
  webappDir: string;
  appDir: string;
  context: string;
  log?: (m: string) => void;
}): string[] {
  const log = opts.log ?? (() => {});
  const destRoot = join(opts.appDir, 'public', opts.context);
  const cssUrls: string[] = [];
  let count = 0;

  const walk = (srcDir: string): void => {
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      if (entry.name === 'WEB-INF' || entry.name === 'META-INF') continue;
      const src = join(srcDir, entry.name);
      if (entry.isDirectory()) {
        walk(src);
        continue;
      }
      if (entry.name.toLowerCase().endsWith('.jsp')) continue; // server templates, not static assets
      const rel = relative(opts.webappDir, src).split(sep).join('/');
      const dst = join(destRoot, rel);
      mkdirSync(join(dst, '..'), { recursive: true });
      cpSync(src, dst);
      count++;
      if (extname(entry.name).toLowerCase() === '.css') {
        cssUrls.push(`/${opts.context}/${rel}`);
      }
    }
  };
  walk(opts.webappDir);
  log(
    `  📦 mirrored ${count} static asset(s) (${cssUrls.length} stylesheet(s)) from the webapp → public/${opts.context}/`,
  );
  return cssUrls;
}

/** Inject `<link rel="stylesheet">` tags for the given URLs into the React app's index.html `<head>`. */
export function injectStylesheets(indexHtmlPath: string, cssUrls: string[]): void {
  if (!existsSync(indexHtmlPath) || cssUrls.length === 0) return;
  let html = readFileSync(indexHtmlPath, 'utf8');
  const marker = '<!-- legacy-stylesheets -->';
  // Re-injecting: drop any previous block first so re-runs don't pile up.
  html = html.replace(new RegExp(`\\s*${marker}[\\s\\S]*?${marker}`, 'g'), '');
  const links = [
    `    ${marker}`,
    ...cssUrls.map((u) => `    <link rel="stylesheet" href="${u}" />`),
    `    ${marker}`,
  ].join('\n');
  html = html.includes('</head>')
    ? html.replace('</head>', `${links}\n  </head>`)
    : `${links}\n${html}`;
  writeFileSync(indexHtmlPath, html);
}
