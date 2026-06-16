import { LOOM, TAGLINE } from '@loom/tokens';

/**
 * The Mission Control dashboard: one self-contained HTML document (no build step, pod-friendly),
 * themed from `@loom/tokens`. A clean, flat, light-first console — a left rail of sections, a
 * sticky run header, and the Loom three-keys mark in a crimson ecosystem accent (light + dark
 * modes). It polls `/api/state` (run, pipeline, cost, the gates/questions inbox, recent events)
 * and `/api/inventory` (built-in tools, skills, external + DIGIT MCP/agents) and writes back only
 * human decisions — approve/reject a gate (a skill gate activates its skill), answer a question.
 * Buttons use event delegation via `data-*` attributes; no inline handlers.
 */
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Loom · Mission Control</title>
<style>
:root {
  --thread: ${LOOM.thread}; --pass: ${LOOM.pass}; --fail: ${LOOM.fail};
  --info: ${LOOM.info}; --gate: ${LOOM.gate}; --agent: ${LOOM.agent};
  --radius: 14px;
}
html[data-theme="light"] {
  --canvas: #F4F5F7; --surface: #FFFFFF; --surface-2: #F6F7F9; --sidebar: #FFFFFF;
  --text: #1A1D26; --muted: #697086;
  --border: #E7E9EE; --border-2: #D7DAE2;
  --shadow: 0 1px 2px rgba(16,24,40,.04), 0 2px 8px rgba(16,24,40,.05);
  --brand: #E6002E; --brand-ink: #C30027; --brand-weak: rgba(230,0,46,.08);
}
html[data-theme="dark"] {
  --canvas: #0B0D13; --surface: #14161F; --surface-2: #1B1E2A; --sidebar: #0E1017;
  --text: #ECEAE3; --muted: #8B90A2;
  --border: rgba(255,255,255,.08); --border-2: rgba(255,255,255,.15);
  --shadow: 0 1px 2px rgba(0,0,0,.45), 0 10px 30px rgba(0,0,0,.35);
  --brand: #FF3D5E; --brand-ink: #FF6379; --brand-weak: rgba(255,61,94,.15);
}
* { box-sizing: border-box; }
html, body { height: 100%; }
html { scroll-behavior: smooth; }
body {
  margin: 0; color: var(--text);
  font: 14px/1.55 Inter, ui-sans-serif, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;
  background: var(--canvas);
  -webkit-font-smoothing: antialiased;
}

/* ---- shell: left rail + content column ---- */
.app { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 100vh; }
.sidebar {
  position: sticky; top: 0; height: 100vh; overflow-y: auto;
  background: var(--sidebar); border-right: 1px solid var(--border);
  padding: 18px 14px; display: flex; flex-direction: column; gap: 2px;
}
.brand { display: flex; align-items: center; gap: 11px; padding: 6px 8px 16px; }
.brand .keys { filter: drop-shadow(0 1px 5px color-mix(in srgb, var(--brand) 40%, transparent)); }
.brand .bname { display: block; font-size: 16px; font-weight: 800; letter-spacing: .16em; line-height: 1; }
.brand .btag { display: block; font-size: 10.5px; color: var(--muted); letter-spacing: .07em; margin-top: 5px; text-transform: uppercase; }
.navgroup { font-size: 10px; text-transform: uppercase; letter-spacing: .14em; color: var(--muted); font-weight: 700; padding: 14px 10px 6px; opacity: .85; }
.nav {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px;
  color: var(--muted); text-decoration: none; font-weight: 500; font-size: 13px;
  position: relative; transition: background .14s ease, color .14s ease;
}
.nav svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.nav .navt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav:hover { background: var(--surface-2); color: var(--text); }
.nav.active { background: var(--brand-weak); color: var(--brand); font-weight: 600; }
.nav.active::before { content: ""; position: absolute; left: 3px; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; background: var(--brand); }
.navc {
  margin-left: auto; min-width: 19px; height: 18px; padding: 0 6px; border-radius: 999px;
  font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center;
  color: var(--muted); background: transparent; border: 1px solid var(--border);
  font-variant-numeric: tabular-nums; transition: all .15s ease;
}
.navc.has { color: var(--text); background: var(--surface-2); border-color: var(--border-2); }
#c-live.has { color: #fff; background: var(--info); border-color: var(--info); }
#c-inbox.has { color: #fff; background: var(--brand); border-color: var(--brand); }
.side-foot { margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 14px 10px 4px; font-size: 11px; color: var(--muted); border-top: 1px solid var(--border); }
.livedot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--pass); flex: none;
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--pass) 55%, transparent); animation: pulse 2.2s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--pass) 50%, transparent); }
  70% { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

.content { display: flex; flex-direction: column; min-width: 0; }
.topbar {
  position: sticky; top: 0; z-index: 5; height: 60px;
  display: flex; align-items: center; gap: 14px; padding: 0 24px;
  background: color-mix(in srgb, var(--canvas) 85%, transparent);
  backdrop-filter: blur(10px) saturate(120%); border-bottom: 1px solid var(--border);
}
.runline { display: flex; align-items: center; gap: 9px; min-width: 0; }
.runline .runlabel { font-size: 10px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); font-weight: 700; }
#run { color: var(--muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spacer { flex: 1; }
.tagline { color: var(--muted); font-size: 11.5px; letter-spacing: .02em; }
@media (max-width: 720px) { .tagline { display: none; } }
.toggle {
  border: 1px solid var(--border-2); background: var(--surface); color: var(--text);
  width: 38px; height: 38px; border-radius: 10px; cursor: pointer; font-size: 16px;
  display: grid; place-items: center; transition: transform .15s ease, border-color .15s ease, color .15s ease;
}
.toggle:hover { transform: translateY(-1px); border-color: var(--brand); color: var(--brand); }

main {
  display: grid; gap: 16px; padding: 20px 24px 48px;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  align-items: start;
}
main section[id] { scroll-margin-top: 76px; }
section {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 16px 18px; min-width: 0;
}
section.wide { grid-column: 1 / -1; }
@media (max-width: 880px) {
  .app { grid-template-columns: 1fr; }
  .sidebar { position: static; height: auto; }
  .sidebar nav { display: flex; flex-wrap: wrap; gap: 2px; }
  .navgroup { width: 100%; }
}
section h2 {
  margin: 0 0 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .12em;
  color: var(--muted); font-weight: 700; display: flex; align-items: center; gap: 9px;
}
section h2 .hbar { width: 3px; height: 13px; border-radius: 2px; background: var(--brand); flex: none; }
.dt { color: var(--text); text-transform: none; letter-spacing: 0; font-weight: 600; font-size: 12.5px; }
.iconbtn {
  margin-left: auto; border: 1px solid var(--border); background: var(--surface); color: var(--muted);
  width: 26px; height: 26px; border-radius: 8px; cursor: pointer; font-size: 17px; line-height: 1;
  display: grid; place-items: center; transition: border-color .14s ease, color .14s ease;
}
.iconbtn:hover { border-color: var(--fail); color: var(--fail); }

.tally { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 8px; }
.tally span { white-space: nowrap; font-size: 12.5px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: 1px; }
.s-passed, .s-shipped { color: var(--pass); } .d-passed, .d-shipped { background: var(--pass); }
.s-building, .s-evaluating, .s-fixing { color: var(--info); } .d-building, .d-evaluating, .d-fixing { background: var(--info); }
.s-blocked, .s-failed, .s-needs_human { color: var(--fail); } .d-blocked, .d-failed, .d-needs_human { background: var(--fail); }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--border); }
.row:first-of-type { border-top: 0; padding-top: 2px; }
.row .name, .name { font-weight: 600; color: var(--text); }
.row .desc, .desc { color: var(--muted); font-size: 12.5px; margin-top: 1px; }
.nm { font-weight: 600; }
.grow { flex: 1; min-width: 0; }
.ellip, .el { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: var(--muted); }
.fail { color: var(--fail); }
.pill {
  --c: var(--muted); font-size: 10.5px; letter-spacing: .02em; padding: 2px 9px; border-radius: 999px;
  white-space: nowrap; font-weight: 600; color: var(--c);
  background: color-mix(in srgb, var(--c) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 26%, transparent);
}
.pill.thread { --c: var(--thread); }
.pill.pass { --c: var(--pass); }
.pill.agent { --c: var(--agent); }
.cost { font-size: 25px; font-weight: 700; color: var(--text); line-height: 1.25; letter-spacing: -.01em; }
.cost b { color: var(--text); font-weight: 700; }
.cost .row { font-weight: 400; }
.sub, .cost .sub { display: block; margin-top: 3px; font-size: 12px; font-weight: 400; color: var(--muted); letter-spacing: 0; line-height: 1.5; }
button.act {
  font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; border-radius: 9px; padding: 6px 14px;
  border: 1px solid var(--border-2); background: var(--surface); color: var(--text);
  transition: transform .12s ease, border-color .12s ease, color .12s ease, background .12s ease; margin: 10px 8px 0 0;
}
button.act:hover { transform: translateY(-1px); border-color: var(--brand); color: var(--brand); }
button.approve { border-color: color-mix(in srgb, var(--pass) 45%, var(--border)); color: var(--pass); }
button.approve:hover { border-color: var(--pass); color: var(--pass); background: color-mix(in srgb, var(--pass) 12%, transparent); }
button.reject { border-color: color-mix(in srgb, var(--fail) 45%, var(--border)); color: var(--fail); }
button.reject:hover { border-color: var(--fail); color: var(--fail); background: color-mix(in srgb, var(--fail) 12%, transparent); }
.gate, .q { padding: 12px 0; border-top: 1px solid var(--border); }
.gate:first-child, .q:first-child { border-top: 0; }
input.answer {
  font: inherit; background: var(--surface-2); color: var(--text); border: 1px solid var(--border-2);
  border-radius: 9px; padding: 7px 11px; margin-top: 10px; width: 62%; min-width: 170px;
}
input.answer:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-weak); }
.feed { font-size: 12px; color: var(--muted); max-height: 300px; overflow: auto; }
.feed div { padding: 2.5px 0; }
.feed time { color: var(--thread); opacity: .9; font-variant-numeric: tabular-nums; margin-right: 6px; }
.cat { color: var(--thread); font-size: 10.5px; text-transform: uppercase; letter-spacing: .1em; font-weight: 700; margin: 14px 0 6px; }
.cat:first-child { margin-top: 0; }
a { color: var(--info); text-decoration: none; }
a:hover { text-decoration: underline; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 10px; border: 2px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <svg class="keys" width="28" height="28" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <g stroke="var(--brand)" stroke-width="1.8" fill="none" stroke-linecap="round">
          <circle cx="6.5" cy="7" r="3.2"/><path d="M6.5 10.2 V20 M6.5 16 h3 M6.5 18.5 h2.4"/>
          <circle cx="13" cy="6" r="3.2"/><path d="M13 9.2 V21 M13 15 h3 M13 17.5 h2.4"/>
          <circle cx="19.5" cy="7" r="3.2"/><path d="M19.5 10.2 V20 M19.5 16 h3 M19.5 18.5 h2.4"/>
        </g>
      </svg>
      <span><span class="bname">LOOM</span><span class="btag">Mission Control</span></span>
    </div>
    <nav>
      <div class="navgroup">Observe</div>
      <a class="nav" data-sec="sec-live" href="#sec-live"><svg viewBox="0 0 16 16"><path d="M1.8 8H4l1.4-4 2.2 8 1.5-6 1 4 1-2h3.1"/></svg><span class="navt">Live now</span><span class="navc" id="c-live">0</span></a>
      <a class="nav" data-sec="sec-pipeline" href="#sec-pipeline"><svg viewBox="0 0 16 16"><path d="M3 13.2V7M8 13.2V3M13 13.2V9.4"/></svg><span class="navt">Pipeline</span><span class="navc" id="c-screens">0</span></a>
      <a class="nav" data-sec="sec-cost" href="#sec-cost"><svg viewBox="0 0 16 16"><ellipse cx="8" cy="4.6" rx="4.7" ry="1.9"/><path d="M3.3 4.6v6.8c0 1 2.1 1.9 4.7 1.9s4.7-.9 4.7-1.9V4.6M3.3 8c0 1 2.1 1.9 4.7 1.9s4.7-.9 4.7-1.9"/></svg><span class="navt">Cost</span></a>
      <a class="nav" data-sec="sec-evals" href="#sec-evals"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.7"/><path d="M5.6 8.1l1.7 1.7L10.6 6"/></svg><span class="navt">Eval analytics</span></a>
      <div class="navgroup">Human in the loop</div>
      <a class="nav" data-sec="sec-inbox" href="#sec-inbox"><svg viewBox="0 0 16 16"><path d="M2.6 9.4h2.8l1 1.6h3.2l1-1.6h2.8M4.4 3.8h7.2l1.8 5.6V12a1 1 0 01-1 1H3.6a1 1 0 01-1-1V9.4z"/></svg><span class="navt">Inbox</span><span class="navc" id="c-inbox">0</span></a>
      <a class="nav" data-sec="sec-recent" href="#sec-recent"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.7"/><path d="M8 4.8V8l2.3 1.4"/></svg><span class="navt">Recent activity</span></a>
      <div class="navgroup">Inventory</div>
      <a class="nav" data-sec="sec-skills" href="#sec-skills"><svg viewBox="0 0 16 16"><path d="M8 2.4l1.5 3.9 3.9 1.5-3.9 1.5L8 13.2 6.5 9.3 2.6 7.8l3.9-1.5z"/></svg><span class="navt">Skills</span><span class="navc" id="c-skills">0</span></a>
      <a class="nav" data-sec="sec-tools" href="#sec-tools"><svg viewBox="0 0 16 16"><path d="M3 5.2h6.2M12 5.2h1M3 10.8h1M6.8 10.8h6.2"/><circle cx="10.6" cy="5.2" r="1.5"/><circle cx="5.4" cy="10.8" r="1.5"/></svg><span class="navt">Tools</span></a>
      <a class="nav" data-sec="sec-mcp" href="#sec-mcp"><svg viewBox="0 0 16 16"><path d="M6 2.6v2.8M10 2.6v2.8M4.6 5.4h6.8v1.8a3.4 3.4 0 01-6.8 0zM8 10.6v2.8"/></svg><span class="navt">MCP servers</span></a>
      <a class="nav" data-sec="sec-digit" href="#sec-digit"><svg viewBox="0 0 16 16"><path d="M8 4.2C7 3.4 5.6 3.2 3 3.4v8.4c2.6-.2 4 0 5 .8M8 4.2c1-.8 2.4-1 5-.8v8.4c-2.6-.2-4 0-5 .8M8 4.2v8.8"/></svg><span class="navt">DIGIT library</span><span class="navc" id="c-digit">0</span></a>
    </nav>
    <div class="side-foot"><span class="livedot"></span>Live &middot; auto-refresh 2s</div>
  </aside>
  <div class="content">
    <header class="topbar">
      <span class="runline"><span class="livedot"></span><span class="runlabel">Run</span><span id="run"></span></span>
      <span class="spacer"></span>
      <span class="tagline">${TAGLINE}</span>
      <button class="toggle" id="theme" title="Toggle light / dark">&#9789;</button>
    </header>
    <main>
      <section class="wide" id="sec-live"><h2><span class="hbar"></span>Live now</h2><div id="live"></div></section>
      <section class="wide" id="sec-pipeline"><h2><span class="hbar"></span>Pipeline</h2>
        <div id="tally" class="tally"></div><div id="screens"></div></section>
      <section class="wide" id="detailwrap" style="display:none"><h2><span class="hbar"></span>Work package <span id="detail-title" class="dt"></span><button class="iconbtn" id="detail-close" title="Close" aria-label="Close inspector">&times;</button></h2><div id="detail"></div></section>
      <section id="sec-cost"><h2><span class="hbar"></span>Cost</h2><div id="cost" class="cost"></div></section>
      <section id="sec-evals"><h2><span class="hbar"></span>Eval analytics</h2><div id="evals"></div></section>
      <section class="wide" id="sec-inbox"><h2><span class="hbar"></span>Inbox &mdash; gates &amp; questions</h2>
        <div id="inbox"></div></section>
      <section id="sec-recent"><h2><span class="hbar"></span>Recent</h2><div id="feed" class="feed"></div></section>
      <section id="sec-skills"><h2><span class="hbar"></span>Skills</h2><div id="skills"></div></section>
      <section id="sec-tools"><h2><span class="hbar"></span>Tools</h2><div id="tools"></div></section>
      <section id="sec-mcp"><h2><span class="hbar"></span>MCP servers</h2><div id="mcp"></div></section>
      <section id="sec-digit"><h2><span class="hbar"></span>DIGIT library</h2><div id="digit"></div></section>
    </main>
  </div>
</div>
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
<script>
// progressive enhancement: scrollspy for the rail, live nav badges, inspector close.
(function () {
  try {
    const links = Array.prototype.slice.call(document.querySelectorAll('.nav[data-sec]'));
    const byId = {};
    links.forEach((a) => { byId[a.getAttribute('data-sec')] = a; });
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          links.forEach((a) => a.classList.remove('active'));
          const a = byId[e.target.id]; if (a) a.classList.add('active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    document.querySelectorAll('main section[id]').forEach((s) => spy.observe(s));
  } catch (e) {}

  try {
    document.querySelectorAll('.navc').forEach((b) => {
      const paint = () => { const v = (b.textContent || '').trim(); b.classList.toggle('has', v !== '' && v !== '0'); };
      new MutationObserver(paint).observe(b, { childList: true, characterData: true, subtree: true });
      paint();
    });
  } catch (e) {}

  try {
    const close = document.getElementById('detail-close');
    if (close) close.addEventListener('click', () => { const d = document.getElementById('detailwrap'); if (d) d.style.display = 'none'; });
  } catch (e) {}
}());
</script>
</body>
</html>`;
}
