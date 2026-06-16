import type { DomSnapshot } from '@loom/browser';

function collectAnchors(node: DomSnapshot, hrefs: string[]): void {
  if (node.tag === 'a' && node.attrs.href) hrefs.push(node.attrs.href);
  for (const child of node.children) collectAnchors(child, hrefs);
}

/**
 * Same-origin navigation targets from a captured DOM — the crawler's BFS
 * frontier. Resolves relative hrefs against the page URL, drops cross-origin /
 * fragment / `javascript:` / `mailto:` links, strips the hash, and dedupes.
 */
export function extractLinks(dom: DomSnapshot, baseUrl: string): string[] {
  const hrefs: string[] = [];
  collectAnchors(dom, hrefs);

  const origin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return null;
    }
  })();

  const out = new Set<string>();
  for (const href of hrefs) {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^(javascript|mailto|tel):/i.test(trimmed)) continue;
    let resolved: URL;
    try {
      resolved = new URL(trimmed, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    if (origin && resolved.origin !== origin) continue;
    resolved.hash = '';
    out.add(resolved.toString());
  }
  return [...out];
}
