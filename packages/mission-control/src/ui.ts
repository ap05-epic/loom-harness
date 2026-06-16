import { LOOM, TAGLINE } from '@loom/tokens';

/**
 * The Mission Control dashboard: one self-contained HTML document (no build step, pod-friendly),
 * themed from `@loom/tokens`. A premium glassmorphism surface with light/dark modes and the Loom
 * three-keys mark. It polls `/api/state` (run, pipeline, cost, the gates/questions inbox, recent
 * events) and `/api/inventory` (built-in tools, skills, external + DIGIT MCP/agents) and writes
 * back only human decisions — approve/reject a gate (a skill gate activates its skill), answer a
 * question. Buttons use event delegation via `data-*` attributes; no inline handlers.
 */
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Loom · Mission Control</title>
<style>
:root {
  --thread: ${LOOM.thread}; --pass: ${LOOM.pass}; --fail: ${LOOM.fail};
  --info: ${LOOM.info}; --gate: ${LOOM.gate}; --agent: ${LOOM.agent};
  --radius: 16px;
}
html[data-theme="dark"] {
  --bg0: #0E1017; --bg1: #14161F; --text: #ECEAE3; --muted: #8E92A0;
  --glass: rgba(255,255,255,0.045); --glass-2: rgba(255,255,255,0.07);
  --stroke: rgba(255,255,255,0.10); --stroke-2: rgba(255,255,255,0.16);
  --shadow: 0 10px 40px rgba(0,0,0,0.45);
}
html[data-theme="light"] {
  --bg0: #F2EFE7; --bg1: #FBF9F4; --text: #1A1D28; --muted: #6A6E7C;
  --glass: rgba(255,255,255,0.55); --glass-2: rgba(255,255,255,0.72);
  --stroke: rgba(20,22,31,0.08); --stroke-2: rgba(20,22,31,0.16);
  --shadow: 0 10px 36px rgba(60,50,30,0.12);
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; color: var(--text);
  font: 14px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Inter, system-ui, sans-serif;
  background: var(--bg0);
  -webkit-font-smoothing: antialiased;
}
/* woven-light mesh behind the glass */
body::before {
  content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(60% 50% at 12% 8%, color-mix(in srgb, var(--thread) 22%, transparent), transparent 70%),
    radial-gradient(50% 45% at 88% 14%, color-mix(in srgb, var(--agent) 18%, transparent), transparent 70%),
    radial-gradient(55% 50% at 75% 92%, color-mix(in srgb, var(--info) 14%, transparent), transparent 72%),
    linear-gradient(180deg, var(--bg0), var(--bg1));
}
header {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 14px;
  padding: 16px 24px;
  background: var(--glass); backdrop-filter: blur(18px) saturate(140%);
  border-bottom: 1px solid var(--stroke);
}
.brand { display: flex; align-items: center; gap: 11px; }
.brand .keys { filter: drop-shadow(0 1px 6px color-mix(in srgb, var(--thread) 55%, transparent)); }
.brand h1 { margin: 0; font-size: 15px; letter-spacing: .14em; font-weight: 700; }
.brand .tag { color: var(--muted); font-size: 11.5px; letter-spacing: .02em; }
#run { color: var(--muted); font-size: 12.5px; margin-left: 4px; }
.spacer { flex: 1; }
.toggle {
  border: 1px solid var(--stroke-2); background: var(--glass-2); color: var(--text);
  width: 38px; height: 38px; border-radius: 11px; cursor: pointer; font-size: 16px;
  display: grid; place-items: center; transition: transform .15s ease, border-color .15s ease;
}
.toggle:hover { transform: translateY(-1px); border-color: var(--thread); }
main {
  display: grid; gap: 18px; padding: 22px 24px 40px;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  max-width: 1480px; margin: 0 auto; align-items: start;
}
section {
  background: var(--glass); backdrop-filter: blur(22px) saturate(135%);
  border: 1px solid var(--stroke); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 16px 18px; min-width: 0;
}
section.wide { grid-column: span 2; }
@media (max-width: 720px) { section.wide { grid-column: span 1; } }
section h2 {
  margin: 0 0 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .13em;
  color: var(--muted); display: flex; align-items: center; gap: 8px;
}
section h2 .count {
  margin-left: auto; font-size: 11px; color: var(--text); background: var(--glass-2);
  border: 1px solid var(--stroke); border-radius: 999px; padding: 1px 9px; letter-spacing: 0;
}
.tally span { margin-right: 14px; white-space: nowrap; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
.s-passed, .s-shipped { color: var(--pass); } .d-passed,.d-shipped { background: var(--pass); }
.s-building,.s-evaluating,.s-fixing { color: var(--info); } .d-building,.d-evaluating,.d-fixing { background: var(--info); }
.s-blocked,.s-failed,.s-needs_human { color: var(--fail); } .d-blocked,.d-failed,.d-needs_human { background: var(--fail); }
.row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-top: 1px solid var(--stroke); }
.row:first-of-type { border-top: 0; }
.row .name { font-weight: 600; }
.row .desc { color: var(--muted); font-size: 12.5px; }
.grow { flex: 1; min-width: 0; }
.ellip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pill {
  font-size: 10.5px; letter-spacing: .03em; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--stroke-2); color: var(--muted); white-space: nowrap;
}
.pill.thread { color: var(--thread); border-color: color-mix(in srgb, var(--thread) 60%, transparent); }
.pill.pass { color: var(--pass); border-color: color-mix(in srgb, var(--pass) 55%, transparent); }
.pill.agent { color: var(--agent); border-color: color-mix(in srgb, var(--agent) 55%, transparent); }
.cost { font-size: 22px; font-weight: 700; }
.cost b { color: var(--thread); }
.cost .sub { font-size: 12px; font-weight: 400; color: var(--muted); }
button.act {
  font: inherit; font-size: 12.5px; cursor: pointer; border-radius: 9px; padding: 5px 12px;
  border: 1px solid var(--stroke-2); background: var(--glass-2); color: var(--text);
  transition: transform .12s ease, border-color .12s ease; margin: 8px 8px 0 0;
}
button.act:hover { transform: translateY(-1px); }
button.approve { border-color: color-mix(in srgb, var(--pass) 60%, transparent); color: var(--pass); }
button.reject { border-color: color-mix(in srgb, var(--fail) 60%, transparent); color: var(--fail); }
.gate, .q { padding: 11px 0; border-top: 1px solid var(--stroke); }
.gate:first-child, .q:first-child { border-top: 0; }
input.answer {
  font: inherit; background: var(--bg1); color: var(--text); border: 1px solid var(--stroke-2);
  border-radius: 9px; padding: 5px 10px; margin-top: 8px; width: 62%; min-width: 160px;
}
.feed { font-size: 12px; color: var(--muted); max-height: 280px; overflow: auto; }
.feed div { padding: 1.5px 0; }
.feed time { color: var(--thread); opacity: .85; }
.muted { color: var(--muted); }
.cat { color: var(--thread); font-size: 10.5px; text-transform: uppercase; letter-spacing: .1em; margin: 12px 0 4px; }
.cat:first-child { margin-top: 0; }
a { color: var(--info); }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--stroke-2); border-radius: 9px; }
</style>
</head>
<body>
<header>
  <span class="brand">
    <svg class="keys" width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <g stroke="var(--thread)" stroke-width="1.7" fill="none">
        <circle cx="6.5" cy="7" r="3.2"/><path d="M6.5 10.2 V20 M6.5 16 h3 M6.5 18.5 h2.4"/>
        <circle cx="13" cy="6" r="3.2"/><path d="M13 9.2 V21 M13 15 h3 M13 17.5 h2.4"/>
        <circle cx="19.5" cy="7" r="3.2"/><path d="M19.5 10.2 V20 M19.5 16 h3 M19.5 18.5 h2.4"/>
      </g>
    </svg>
    <span>
      <h1>LOOM</h1>
    </span>
    <span class="tag">Mission Control &mdash; ${TAGLINE}</span>
  </span>
  <span id="run"></span>
  <span class="spacer"></span>
  <button class="toggle" id="theme" title="Toggle light / dark">&#9789;</button>
</header>
<main>
  <section class="wide"><h2>Live now <span class="count" id="c-live">0</span></h2><div id="live"></div></section>
  <section class="wide"><h2>Pipeline <span class="count" id="c-screens">0</span></h2>
    <div id="tally" class="tally"></div><div id="screens"></div></section>
  <section class="wide" id="detailwrap" style="display:none"><h2>Work package &mdash; <span id="detail-title"></span></h2><div id="detail"></div></section>
  <section><h2>Cost</h2><div id="cost" class="cost"></div></section>
  <section><h2>Eval analytics</h2><div id="evals"></div></section>
  <section class="wide"><h2>Inbox &mdash; gates &amp; questions <span class="count" id="c-inbox">0</span></h2>
    <div id="inbox"></div></section>
  <section><h2>Recent</h2><div id="feed" class="feed"></div></section>
  <section><h2>Skills <span class="count" id="c-skills">0</span></h2><div id="skills"></div></section>
  <section><h2>Tools</h2><div id="tools"></div></section>
  <section><h2>MCP servers</h2><div id="mcp"></div></section>
  <section><h2>DIGIT library <span class="count" id="c-digit">0</span></h2><div id="digit"></div></section>
</main>
<script>
const h = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $ = (id) => document.getElementById(id);

// theme
const root = document.documentElement;
const saved = localStorage.getItem('loom-theme');
if (saved) root.setAttribute('data-theme', saved);
function paintToggle() { $('theme').innerHTML = root.getAttribute('data-theme') === 'light' ? '\\u263E' : '\\u2600'; }
paintToggle();
$('theme').addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next); localStorage.setItem('loom-theme', next); paintToggle();
});

// human-in-the-loop actions (event delegation)
async function post(url, body) {
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  refresh();
}
document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t.dataset && t.dataset.gate) post('/api/gates/' + t.dataset.gate, { decision: t.dataset.decision });
  if (t.dataset && t.dataset.answer) { const v = $('q-' + t.dataset.answer).value; if (v) post('/api/questions/' + t.dataset.answer, { answer: v }); }
  const wpRow = t.closest && t.closest('[data-wp]');
  if (wpRow) showDetail(wpRow.dataset.wp);
});
async function showDetail(wpId) {
  try {
    const d = await (await fetch('/api/wp/' + wpId)).json();
    $('detailwrap').style.display = '';
    $('detail-title').textContent = (d.screenKey || d.wpId) + ' \\u00b7 ' + d.state;
    $('detail').innerHTML =
      (d.bestEval ? '<div class="sub">best eval: <span class="s-' + (d.bestEval.passed ? 'passed' : 'blocked') + '">'
        + (d.bestEval.passed ? 'passed' : 'not passed') + '</span>'
        + (d.bestEval.visualPct != null ? ' \\u00b7 ' + d.bestEval.visualPct.toFixed(2) + '%' : '') + '</div>' : '')
      + (d.attempts || []).map((a) => {
          const cls = a.status === 'passed' ? 'passed' : (a.status === 'failed' || a.status === 'guard_tripped') ? 'blocked' : 'building';
          return '<div class="row"><span class="grow">attempt ' + a.n + ' <span class="muted">' + h(a.role)
            + '</span> <span class="s-' + cls + '">' + h(a.status) + '</span></span><span class="muted" style="font-size:12px">'
            + (a.inputTokens + a.outputTokens) + ' tok' + (a.failureReason ? ' \\u00b7 ' + h(a.failureReason) : '') + '</span></div>';
        }).join('');
  } catch (e) {}
}

function pill(text, cls) { return '<span class="pill ' + (cls || '') + '">' + h(text) + '</span>'; }
function elapsed(start, end) {
  const a = Date.parse(start), b = end ? Date.parse(end) : Date.now();
  if (isNaN(a)) return '';
  const s = Math.max(0, Math.round((b - a) / 1000)), m = Math.floor(s / 60), hh = Math.floor(m / 60);
  return hh ? hh + 'h ' + (m % 60) + 'm' : m ? m + 'm' : s + 's';
}

function renderState(s) {
  $('run').textContent = s.run
    ? '\\u2014 ' + s.run.project + ' \\u00b7 run ' + s.run.id + ' [' + (s.run.stage || s.run.status) + ']'
      + (s.run.startedAt ? ' \\u00b7 ' + elapsed(s.run.startedAt, s.run.finishedAt) : '')
    : '\\u2014 no active run';
  const live = s.liveNow || [];
  $('c-live').textContent = live.length;
  $('live').innerHTML = live.map((w) =>
    '<div class="row" data-wp="' + w.wpId + '" style="cursor:pointer"><span class="dot d-' + w.state + '"></span><span class="grow el"><span class="nm">'
    + h(w.screenKey || w.wpId) + '</span> <span class="s-' + w.state + '">' + w.state + '</span>'
    + ' <span class="muted">attempt ' + w.attempt + '</span></span>'
    + (w.lastEvent ? '<span class="muted" style="font-size:12px">' + h(w.lastEvent)
        + (w.lastEventTs ? ' \\u00b7 ' + h(w.lastEventTs.slice(11, 19)) : '') + '</span>' : '') + '</div>').join('')
    || '<span class="muted">idle \\u2014 no workers building right now</span>';
  $('c-screens').textContent = (s.screens || []).length;
  $('tally').innerHTML = Object.entries(s.counts || {})
    .map(([st, n]) => '<span class="s-' + st + '"><span class="dot d-' + st + '"></span>' + n + ' ' + st + '</span>').join('')
    || '<span class="muted">no screens yet</span>';
  $('screens').innerHTML = (s.screens || []).map((x) =>
    '<div class="row" data-wp="' + x.wpId + '" style="cursor:pointer"><span class="grow ellip">' + h(x.screenKey || x.wpId) + '</span>'
    + '<span class="s-' + x.state + '">' + x.state + '</span>'
    + (x.diffPercent != null ? '<span class="muted">' + x.diffPercent.toFixed(2) + '%</span>' : '') + '</div>').join('');
  const c = s.cost || {};
  $('cost').innerHTML = '<b>' + ((c.inputTokens || 0) + (c.outputTokens || 0)).toLocaleString() + '</b> tokens'
    + '<div class="sub">' + (c.inputTokens || 0) + ' in / ' + (c.outputTokens || 0) + ' out \\u00b7 ' + (c.spans || 0) + ' spans \\u00b7 '
    + Math.round((c.totalDurationMs || 0) / 1000) + 's</div>'
    + (s.costByModel || []).map((m) =>
        '<div class="row" style="font-size:12px"><span class="grow el">' + h(m.model)
        + '</span><span class="muted">' + m.tokens.toLocaleString() + ' \\u00b7 ' + m.attempts + ' att</span></div>').join('');
  const ev = s.evalAnalytics || { evaluated: 0, passed: 0, passRate: 0, failureReasons: [] };
  $('evals').innerHTML = '<div class="cost"><b>' + Math.round((ev.passRate || 0) * 100) + '%</b>'
    + '<span class="sub"> pass rate \\u00b7 ' + ev.passed + '/' + ev.evaluated + ' screens</span></div>'
    + (ev.failureReasons && ev.failureReasons.length
        ? '<div class="cat">why attempts fail</div>' + ev.failureReasons.map((f) =>
            '<div class="row" style="font-size:12px"><span class="grow el fail">' + h(f.reason)
            + '</span><span class="muted">' + f.count + '</span></div>').join('')
        : '<div class="muted" style="margin-top:6px">no failed attempts</div>');
  const gates = (s.gates || []).map((g) =>
    '<div class="gate"><div class="row" style="border:0;padding:0">' + pill(g.type, 'gate' === g.type ? 'thread' : 'thread')
    + '<span class="grow ellip muted">' + h(JSON.stringify(g.payload)) + '</span></div>'
    + '<button class="act approve" data-gate="' + g.id + '" data-decision="approve">Approve</button>'
    + '<button class="act reject" data-gate="' + g.id + '" data-decision="reject">Reject</button></div>').join('');
  const qs = (s.questions || []).map((q) =>
    '<div class="q"><div>' + h(q.question) + '</div>'
    + '<input class="answer" id="q-' + q.id + '" placeholder="answer\\u2026" />'
    + '<button class="act" data-answer="' + q.id + '">Answer</button></div>').join('');
  $('c-inbox').textContent = (s.gates || []).length + (s.questions || []).length;
  $('inbox').innerHTML = (gates + qs) || '<span class="muted">nothing waiting \\u2014 all clear</span>';
  $('feed').innerHTML = (s.recent || []).slice().reverse().map((e) =>
    '<div><time>' + h(e.ts.slice(11, 19)) + '</time> ' + h(e.type) + (e.wpId ? ' <span class="muted">' + h(e.wpId) + '</span>' : '') + '</div>').join('');
}

function renderInventory(inv) {
  const skills = inv.skills || [];
  $('c-skills').textContent = skills.length;
  $('skills').innerHTML = skills.map((sk) =>
    '<div class="row"><span class="grow"><span class="name">' + h(sk.name) + '</span>'
    + '<div class="desc ellip">' + h(sk.description) + '</div></span>'
    + pill(sk.tier, sk.tier === 'bundled' ? 'pass' : '')
    + pill(sk.status === 'file' ? 'file' : sk.status, sk.status === 'active' ? 'pass' : sk.status === 'draft' ? 'thread' : '')
    + (sk.source === 'db' ? '<span class="muted" style="font-size:11px">' + sk.successCount + '/' + sk.useCount + '</span>' : '') + '</div>').join('')
    || '<span class="muted">no skills yet</span>';

  const byCat = {};
  (inv.tools || []).forEach((t) => { (byCat[t.category] = byCat[t.category] || []).push(t); });
  $('tools').innerHTML = Object.entries(byCat).map(([cat, ts]) =>
    '<div class="cat">' + h(cat) + '</div>' + ts.map((t) =>
      '<div class="row"><span class="grow"><span class="name">' + h(t.name) + '</span>'
      + '<div class="desc">' + h(t.description) + '</div></span></div>').join('')).join('')
    || '<span class="muted">none</span>';

  $('mcp').innerHTML = (inv.mcpExternal || []).map((m) =>
    '<div class="row"><span class="grow"><span class="name">' + h(m.name) + '</span>'
    + '<div class="desc ellip">' + h(m.description) + '</div></span>' + pill('external', 'agent') + '</div>').join('')
    || '<span class="muted">no external MCP servers attached</span>';

  const d = inv.digit || { skills: [], agents: [], mcp: [] };
  $('c-digit').textContent = (d.skills.length + d.agents.length + d.mcp.length);
  const grp = (label, items, cls) => items.length
    ? '<div class="cat">' + label + '</div>' + items.map((i) =>
        '<div class="row"><span class="grow ellip"><span class="name">' + h(i.name) + '</span>'
        + (i.description ? ' <span class="desc">' + h(i.description) + '</span>' : '') + '</span>' + pill(label.slice(0, -1), cls) + '</div>').join('')
    : '';
  $('digit').innerHTML = (grp('skills', d.skills, 'thread') + grp('agents', d.agents, 'agent') + grp('mcps', d.mcp, ''))
    || '<span class="muted">no DIGIT library found (~/.copilot)</span>';
}

async function refresh() {
  try { renderState(await (await fetch('/api/state')).json()); } catch (e) {}
  try { renderInventory(await (await fetch('/api/inventory')).json()); } catch (e) {}
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}
