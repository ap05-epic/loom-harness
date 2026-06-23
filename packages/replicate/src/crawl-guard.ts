import type { DomSnapshot, NetworkRequest } from '@loom/browser';
import type { NavLink } from './nav.js';

/**
 * The pure, deterministic brain of the crawler — no browser, no DB, no fs. Decides what is safe to
 * click, what each interaction's stable identity is, and where each rendered value comes from.
 */

/** Labels/targets we NEVER click — they mutate data or end the session. Record them, don't follow them. */
export const DEFAULT_DENY =
  /\b(log\s?-?out|sign\s?-?out|log\s?off|delete|remove|destroy|submit|save|update|confirm|approve|reject|cancel|close|reset|clear|print|export|download|email|send|transmit|wire|pay|execute|purge|terminate|unlock)\b/i;

/** A control is destructive/irreversible if its label OR its target matches the deny‑list (or is a mutation href). */
export function isDestructive(label: string, target: string, deny: RegExp = DEFAULT_DENY): boolean {
  const hay = `${label} ${target}`;
  // Session‑killers: match boundary‑free so `j_security_logout` / `logoutAction` never slip through.
  if (/logout|sign\s?out|log\s?off|j_security/i.test(hay)) return true;
  if (deny.test(label) || deny.test(target)) return true;
  return /\b(action|cmd|do|op)=(delete|remove|save|submit|update|logout|signout)\b/i.test(target);
}

/** Replace a secret (raw + URL‑encoded forms) with a tag so it never persists in any stored string. */
export function redactSecret(s: string, secret: string, tag = '<fa>'): string {
  if (!s || !secret) return s;
  return s.split(secret).join(tag).split(encodeURIComponent(secret)).join(tag);
}

/** Apply {@link redactSecret} for every secret (FA, password) before a body/url/value hits disk. */
export function redactBody(body: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((acc, s) => redactSecret(acc, s), body);
}

/** One thing the crawler can do from a screen + its stable cross‑run identity. */
export type WorkItem = {
  source: 'candidate' | 'navlink';
  /** Frame‑prefixed candidate ref (clickable/fillable); absent for a navlink with no live candidate. */
  ref?: string;
  /** Destination href / form action / js call. */
  target?: string;
  label: string;
  kind: string;
  isTextbox: boolean;
  isDestructive: boolean;
  isJs: boolean;
  /** Stable identity of this interaction FROM its state — dedup + cross‑run resume. */
  sig: string;
};

/** Normalize a label for identity: lowercase, drop punctuation + standalone numbers (so "Account 12,345"
 * and "Account 67,890" collapse to one) and collapse whitespace. Keeps the crawl finite + resumable. */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b\d[\d,]*\b/g, ' ') // standalone numbers → gone
    .replace(/\s+/g, ' ')
    .trim();
}

/** A comparable key for a navigation target — last path segment (no query/suffix), or a js call shape. */
function navKeyish(target: string): string {
  let p = target.trim();
  if (/^javascript:/i.test(p)) {
    const m = p.match(/^javascript:\s*([a-zA-Z0-9_$]+)\s*\(\s*'?([^',)]*)/);
    return m ? `js:${m[1]}(${m[2]})` : 'js';
  }
  p = p
    .split('?')[0]!
    .split('#')[0]!
    .replace(/\.(do|jsp|action)$/i, '');
  return (p.split('/').filter(Boolean).pop() ?? '').toLowerCase();
}

function sigFor(label: string, target: string | undefined, isTextbox: boolean): string {
  const t = target && !/^javascript:/i.test(target) ? navKeyish(target) : '';
  return `${isTextbox ? 'fill' : 'click'}|${normalizeLabel(label)}|${t}`;
}

/** The stable identity of a work item (exposed for the crawler's tried‑set + tests). */
export function interactionSig(item: {
  label: string;
  target?: string;
  isTextbox: boolean;
}): string {
  return sigFor(item.label, item.target, item.isTextbox);
}

/**
 * Build the deterministic work list for one screen: merge live candidates (clickable/fillable, with
 * refs) with the DOM's links (which include the `javascript:` overlays `enumerateCandidates` omits),
 * dedupe by identity, flag destructive/js, and order them stably (textboxes → safe → js → destructive)
 * so the exhaustive crawl is reproducible.
 */
export function buildWorkList(input: {
  candidates: Array<{ ref: string; label: string; kind: string }>;
  navlinks: NavLink[];
  deny?: RegExp;
  followJs?: boolean;
}): WorkItem[] {
  const deny = input.deny ?? DEFAULT_DENY;
  // index real navlinks by normalized label so a clickable candidate inherits its href/kind.
  const navByLabel = new Map<string, NavLink>();
  for (const n of input.navlinks) {
    if (n.kind === 'anchor') continue;
    const k = normalizeLabel(n.label);
    if (k && !navByLabel.has(k)) navByLabel.set(k, n);
  }
  const items: WorkItem[] = [];
  const bySig = new Set<string>();
  const add = (item: WorkItem): void => {
    if (bySig.has(item.sig)) return; // candidates added first (they carry the clickable ref) win
    bySig.add(item.sig);
    items.push(item);
  };

  // Candidates first (they have the overlay‑proof ref).
  for (const c of input.candidates) {
    const nav = navByLabel.get(normalizeLabel(c.label));
    const target = nav?.target;
    const isTextbox = c.kind === 'textbox';
    const isJs = nav?.kind === 'js-action' || (target ? /^javascript:/i.test(target) : false);
    add({
      source: 'candidate',
      ref: c.ref,
      target,
      label: c.label,
      kind: c.kind,
      isTextbox,
      isDestructive: isDestructive(c.label, target ?? '', deny),
      isJs,
      sig: sigFor(c.label, target, isTextbox),
    });
  }
  // Navlinks with no matching candidate — js‑overlays + form actions enumerate skipped.
  for (const n of input.navlinks) {
    if (n.kind === 'anchor') continue;
    add({
      source: 'navlink',
      target: n.target,
      label: n.label,
      kind: n.kind,
      isTextbox: false,
      isDestructive: isDestructive(n.label, n.target, deny),
      isJs: n.kind === 'js-action',
      sig: sigFor(n.label, n.target, false),
    });
  }

  const tier = (w: WorkItem): number => (w.isTextbox ? 0 : w.isDestructive ? 3 : w.isJs ? 2 : 1);
  return items.sort((a, b) => tier(a) - tier(b) || a.sig.localeCompare(b.sig));
}

// ── Data provenance: where does each rendered value come from? ───────────────────────────────────

/** Normalize a value/body for substring matching: drop $ , % ( ) and whitespace, lowercase. */
function normalizeForSearch(s: string): string {
  return s.replace(/[\s$,%()]/g, '').toLowerCase();
}

/** indexOf, but for all‑digit needles require the match not be surrounded by more digits (so "12" ≠ "123456"). */
function boundedIndexOf(hay: string, needle: string): number {
  const allDigits = /^\d+$/.test(needle);
  if (!allDigits) return hay.indexOf(needle);
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return -1;
    const before = i > 0 ? hay[i - 1]! : '';
    const after = i + needle.length < hay.length ? hay[i + needle.length]! : '';
    if (!/\d/.test(before) && !/\d/.test(after)) return i;
    from = i + 1;
  }
}

/** Pull meaningful data values from a leaf text: financial numbers (≥2 digits) + mixed alphanumeric codes. */
function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$?\(?-?\d[\d,]*\.?\d*\)?%?/g)) {
    if (m[0].replace(/\D/g, '').length >= 2) out.push(m[0]);
  }
  for (const m of text.matchAll(/\b[A-Za-z0-9]{4,}\b/g)) {
    if (/\d/.test(m[0]) && /[A-Za-z]/.test(m[0])) out.push(m[0]); // account/deal codes
  }
  return out;
}

function extractValues(dom: DomSnapshot): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const visit = (n: DomSnapshot): void => {
    if (n.text) {
      const text = n.text.replace(/\s+/g, ' ').trim();
      for (const tok of tokenize(text)) out.push({ value: tok, label: text.slice(0, 60) });
    }
    for (const c of n.children) visit(c);
  };
  visit(dom);
  return out;
}

/**
 * Correlate each rendered value to the endpoint whose response body contains it — the deterministic
 * "where does this number come from" map. Best‑effort evidence (first body that contains the
 * comma/`$`‑normalized value, with a bounded match for pure numbers); values in no body are skipped.
 * Capped. The builder can open the saved body to confirm the exact field.
 */
export function correlateProvenance(
  dom: DomSnapshot,
  endpoints: NetworkRequest[],
): Array<{ value: string; endpointUrl: string; label: string; where: number }> {
  const bodies = endpoints
    .filter((e) => e.responseBody)
    .map((e) => ({ url: e.url, body: normalizeForSearch(e.responseBody!) }));
  if (bodies.length === 0) return [];
  const out: Array<{ value: string; endpointUrl: string; label: string; where: number }> = [];
  const seen = new Set<string>();
  for (const v of extractValues(dom)) {
    const needle = normalizeForSearch(v.value);
    if (needle.length < 3 || seen.has(needle)) continue;
    for (const b of bodies) {
      const where = boundedIndexOf(b.body, needle);
      if (where >= 0) {
        out.push({ value: v.value, endpointUrl: b.url, label: v.label, where });
        seen.add(needle);
        break; // first endpoint that backs the value wins
      }
    }
    if (out.length >= 400) break;
  }
  return out;
}
