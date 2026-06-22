import type { DomSnapshot } from '@loom/browser';
import type { CodeAtlas } from '@loom/cartographer';

/**
 * Normalize a legacy action path (e.g. `/wizard.do`, `/BAA/jsp/list.jsp`) or a replica href
 * (e.g. `/wizard`, `https://app/x/creditLine.do?fa=AB10`) into a comparable route slug — the last
 * path segment, lowercased, with query/fragment and the struts/jsp suffix stripped. Returns null for
 * non-navigations (`#`, `javascript:`, `mailto:`, `tel:`, empty).
 */
export function normalizePath(raw: string): string | null {
  let p = raw.trim();
  if (!p || p === '#' || /^(javascript:|mailto:|tel:)/i.test(p)) return null;
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      /* keep the raw value */
    }
  }
  p = p.split('?')[0]!.split('#')[0]!; // drop query + fragment
  p = p.replace(/\.(do|jsp|action)$/i, ''); // drop the struts/jsp suffix
  const seg = p.split('/').filter(Boolean).pop() ?? ''; // the route name
  return seg.toLowerCase() || null;
}

/** A navigation the replica fails to reproduce — a path that exists in the legacy screen but not the replica. */
export type PathFinding = { code: 'missing_route'; target: string; detail: string };

/**
 * Compare the legacy screen's navigation targets against the replica's → the routes the replica is
 * missing. Deterministic, suffix/case/query‑insensitive. No LLM. Empty result ⇒ paths match.
 */
export function comparePaths(legacyTargets: string[], replicaTargets: string[]): PathFinding[] {
  const replica = new Set(replicaTargets.map(normalizePath).filter((x): x is string => x !== null));
  const findings: PathFinding[] = [];
  const seen = new Set<string>();
  for (const raw of legacyTargets) {
    const t = normalizePath(raw);
    if (t === null || seen.has(t)) continue;
    seen.add(t);
    if (!replica.has(t)) {
      findings.push({
        code: 'missing_route',
        target: t,
        detail: `the legacy screen navigates to "${t}" but the replica has no link/route to it`,
      });
    }
  }
  return findings;
}

/** The action paths a legacy screen navigates to: its JSP links/submits + the action's forwards. */
export function legacyNavTargets(atlas: CodeAtlas, screenKey: string): string[] {
  const slice = atlas.sliceForScreen(screenKey);
  if (!slice) return [];
  const out: string[] = [];
  for (const jsp of slice.jsps) {
    for (const n of atlas.linked(jsp.id, 'links_to')) out.push(n.name);
    for (const n of atlas.linked(jsp.id, 'submits_to')) out.push(n.name);
  }
  for (const n of atlas.linked(slice.action.id, 'forwards_to')) out.push(n.name);
  return out;
}

/** The routes the replica's rendered DOM navigates to: every `<a href>` and `<form action>`. */
export function replicaNavTargets(dom: DomSnapshot): string[] {
  const out: string[] = [];
  const visit = (n: DomSnapshot): void => {
    if (n.tag === 'a' && n.attrs.href) out.push(n.attrs.href);
    if (n.tag === 'form' && n.attrs.action) out.push(n.attrs.action);
    for (const c of n.children) visit(c);
  };
  visit(dom);
  return out;
}
