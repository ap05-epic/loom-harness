import { createHash } from 'node:crypto';
import type { DomSnapshot } from '@loom/browser';

/** Attributes that identify a node's structural role (not its data). */
const STRUCTURAL_ATTRS = ['name', 'type', 'role'];

/**
 * A structural fingerprint of a DOM tree: tags + structural attributes, with
 * **identical sibling subtrees collapsed** (so a table with 3 rows and the same
 * table with 50 rows fingerprint the same) and text ignored. This is what lets
 * the crawler treat "same screen, different data" as one state.
 */
export function domSignature(node: DomSnapshot): string {
  const attrs = STRUCTURAL_ATTRS.map((a) => (node.attrs[a] ? `${a}=${node.attrs[a]}` : ''))
    .filter(Boolean)
    .join(',');
  const head = attrs ? `${node.tag}[${attrs}]` : node.tag;
  const childSigs = [...new Set(node.children.map(domSignature))];
  return childSigs.length ? `${head}(${childSigs.join(',')})` : head;
}

export type StateIdentity = {
  url: string;
  /** Path through nested frames/popups, if any. */
  framePath?: string;
  dom: DomSnapshot;
};

/**
 * Origin- and query-independent URL part: the pathname only. Dropping the origin
 * maps local↔prod together; dropping the query string collapses data variants
 * (`/deal?id=1` and `/deal?id=2` are the same "deal" screen) so the crawler
 * doesn't enumerate thousands of rows. Genuinely different screens at one path
 * are still separated by their structure (the dom signature).
 */
function normalizeUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * A stable screen key = hash(path + frame-path + dom-signature). The origin and
 * query are dropped (see `normalizeUrl`), so local↔prod and data variants map
 * together, while structure and frame path keep genuinely different states apart.
 */
export function screenKey(state: StateIdentity): string {
  const material = `${normalizeUrl(state.url)}|${state.framePath ?? ''}|${domSignature(state.dom)}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}
