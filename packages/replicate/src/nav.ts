import type { DomSnapshot } from '@loom/browser';

/** One navigable thing on a screen + where it leads. */
export type NavLink = {
  /** Visible label (link/button text). */
  label: string;
  /** The destination: an href, a form action, or a `javascript:` call. */
  target: string;
  /** real page navigation · a JS-driven action (overlay etc.) · an in-page anchor · a form submit. */
  kind: 'navigation' | 'js-action' | 'anchor' | 'form-submit';
};

/** Normalize a target into a comparable key (last path segment, no query/suffix) for matching. */
function navKey(target: string): string {
  let p = target.trim();
  if (/^javascript:/i.test(p)) {
    // e.g. javascript:getOverlay('filteroverlay','C0M000',…) → getOverlay(filteroverlay)
    const m = p.match(/^javascript:\s*([a-zA-Z0-9_$]+)\s*\(\s*'?([^',)]*)/);
    return m ? `js:${m[1]}(${m[2]})` : `js:${p.slice(11, 40)}`;
  }
  p = p
    .split('?')[0]!
    .split('#')[0]!
    .replace(/\.(do|jsp|action)$/i, '');
  return (p.split('/').filter(Boolean).pop() ?? '').toLowerCase();
}

function classify(target: string): NavLink['kind'] {
  const t = target.trim();
  if (/^javascript:/i.test(t)) return 'js-action';
  if (t === '' || t === '#' || t.startsWith('#')) return 'anchor';
  return 'navigation';
}

/**
 * Extract every navigable element from a captured screen — `<a href>` and `<form action>` — with
 * where each one leads. This is the runtime click→destination map: which clicks are real page
 * navigations (verifiable 1:1) vs JS‑driven actions (overlays etc., behavior we'd have to rebuild).
 */
export function extractNavigation(dom: DomSnapshot): NavLink[] {
  const out: NavLink[] = [];
  const visit = (n: DomSnapshot): void => {
    if (n.tag === 'a' && n.attrs.href !== undefined) {
      out.push({
        label: (n.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 50) || '(no text)',
        target: n.attrs.href,
        kind: classify(n.attrs.href),
      });
    }
    if (n.tag === 'form' && n.attrs.action) {
      out.push({
        label: `form ${n.attrs.name ?? ''}`.trim(),
        target: n.attrs.action,
        kind: 'form-submit',
      });
    }
    for (const c of n.children) visit(c);
  };
  visit(dom);
  return out;
}

/**
 * Compare the legacy navigation against the replica's: every legacy real‑navigation / form‑submit
 * the replica is missing (by destination key). JS‑actions and anchors are reported but not required
 * (the replica can't reproduce raw legacy JS). No LLM.
 */
export function compareNavigation(
  legacy: NavLink[],
  replica: NavLink[],
): { missing: NavLink[]; jsActions: NavLink[] } {
  const replicaKeys = new Set(replica.map((l) => navKey(l.target)));
  const required = legacy.filter((l) => l.kind === 'navigation' || l.kind === 'form-submit');
  const seen = new Set<string>();
  const missing: NavLink[] = [];
  for (const l of required) {
    const k = navKey(l.target);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!replicaKeys.has(k)) missing.push(l);
  }
  return { missing, jsActions: legacy.filter((l) => l.kind === 'js-action') };
}
