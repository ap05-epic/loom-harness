import { LOOM, TAGLINE } from '@loom/tokens';

/**
 * The Mission Control single-page dashboard: one self-contained HTML document (no build step,
 * pod-friendly), themed from `@loom/tokens`. It polls `/api/state` every 2s and renders the
 * pipeline tally, cost, the gates/questions inbox (approve/reject/answer write back to the API),
 * and the recent event feed. Buttons use event delegation via `data-*` attributes — no inline
 * handlers — so there's no quote-escaping to get wrong.
 */
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Loom · Mission Control</title>
<style>
:root {
  --thread: ${LOOM.thread}; --ink: ${LOOM.ink}; --pass: ${LOOM.pass};
  --fail: ${LOOM.fail}; --info: ${LOOM.info}; --gate: ${LOOM.gate}; --agent: ${LOOM.agent};
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--ink); color: #E8E6E0;
  font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
header { padding: 16px 20px; border-bottom: 1px solid #2A2D38; display: flex; align-items: baseline; gap: 12px; }
header .logo { color: var(--thread); font-weight: 700; letter-spacing: .06em; }
header .tag { color: #8A8D98; font-size: 12px; }
main { padding: 16px 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 18px; max-width: 1100px; }
section { background: #1B1E29; border: 1px solid #2A2D38; border-radius: 10px; padding: 14px 16px; }
section h2 { margin: 0 0 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: #8A8D98; }
.tally span { margin-right: 14px; }
.s-passed, .s-shipped { color: var(--pass); }
.s-building, .s-evaluating, .s-fixing { color: var(--info); }
.s-blocked, .s-failed, .s-needs_human { color: var(--fail); }
.row { color: #A8ABB6; padding: 1px 0; }
.gate, .q { border-top: 1px solid #2A2D38; padding: 10px 0; }
button { font: inherit; cursor: pointer; border: 1px solid #3A3D48; background: #23262F; color: #E8E6E0; border-radius: 6px; padding: 4px 10px; margin: 6px 6px 0 0; }
button.approve { border-color: var(--pass); color: var(--pass); }
button.reject { border-color: var(--fail); color: var(--fail); }
input { font: inherit; background: #14161F; color: #E8E6E0; border: 1px solid #3A3D48; border-radius: 6px; padding: 4px 8px; }
.feed { font-size: 12px; color: #A8ABB6; max-height: 260px; overflow: auto; }
.muted { color: #6A6D78; }
.cost b { color: var(--thread); }
</style>
</head>
<body>
<header>
  <span class="logo">&#9783; LOOM</span>
  <span class="tag">Mission Control &mdash; ${TAGLINE}</span>
  <span id="run" class="muted"></span>
</header>
<main>
  <section><h2>Pipeline</h2><div id="tally" class="tally"></div><div id="screens"></div></section>
  <section><h2>Cost</h2><div id="cost" class="cost"></div></section>
  <section><h2>Gates &amp; questions (inbox)</h2><div id="inbox"></div></section>
  <section><h2>Recent</h2><div id="feed" class="feed"></div></section>
</main>
<script>
const h = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function post(url, body) {
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  refresh();
}
document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t.dataset && t.dataset.gate) post('/api/gates/' + t.dataset.gate, { decision: t.dataset.decision });
  if (t.dataset && t.dataset.answer) {
    const v = document.getElementById('q-' + t.dataset.answer).value;
    if (v) post('/api/questions/' + t.dataset.answer, { answer: v });
  }
});
function render(s) {
  document.getElementById('run').textContent = s.run
    ? ' \\u00b7 ' + s.run.project + ' \\u00b7 run ' + s.run.id + ' [' + (s.run.stage || s.run.status) + ']'
    : ' \\u00b7 no active run';
  document.getElementById('tally').innerHTML =
    Object.entries(s.counts || {}).map(([st, n]) => '<span class="s-' + st + '">' + n + ' ' + st + '</span>').join('')
    || '<span class="muted">no screens</span>';
  document.getElementById('screens').innerHTML = (s.screens || []).map((x) =>
    '<div class="row">' + h(x.screenKey || x.wpId) + ' &mdash; <span class="s-' + x.state + '">' + x.state + '</span>'
    + (x.diffPercent != null ? ' \\u00b7 ' + x.diffPercent.toFixed(2) + '%' : '') + '</div>').join('');
  const c = s.cost || {};
  document.getElementById('cost').innerHTML =
    '<div><b>' + ((c.inputTokens || 0) + (c.outputTokens || 0)).toLocaleString() + '</b> tokens ('
    + (c.inputTokens || 0) + ' in / ' + (c.outputTokens || 0) + ' out) \\u00b7 ' + (c.spans || 0) + ' spans</div>';
  const gates = (s.gates || []).map((g) =>
    '<div class="gate"><b style="color:var(--gate)">' + h(g.type) + '</b> ' + h(JSON.stringify(g.payload))
    + '<div><button class="approve" data-gate="' + g.id + '" data-decision="approve">Approve</button>'
    + '<button class="reject" data-gate="' + g.id + '" data-decision="reject">Reject</button></div></div>').join('');
  const qs = (s.questions || []).map((q) =>
    '<div class="q">' + h(q.question) + '<div><input id="q-' + q.id + '" placeholder="answer\\u2026" />'
    + '<button data-answer="' + q.id + '">Answer</button></div></div>').join('');
  document.getElementById('inbox').innerHTML = (gates + qs) || '<span class="muted">nothing waiting</span>';
  document.getElementById('feed').innerHTML = (s.recent || []).slice().reverse().map((e) =>
    '<div>' + h(e.ts.slice(11, 19)) + ' ' + h(e.type) + (e.wpId ? ' ' + h(e.wpId) : '') + '</div>').join('');
}
async function refresh() { try { const r = await fetch('/api/state'); render(await r.json()); } catch (e) {} }
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}
