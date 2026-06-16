import { GateStore, QuestionStore, TaskStore, type SqliteDatabase } from '@loom/core';

/**
 * Render a run as a stakeholder-facing modernization report (markdown): the per-screen status
 * + parity evidence (best visual diff), coverage, token spend, and what's still waiting on a
 * human. Pure over the stores — the doc-writer / `loom report` surface and the audit trail.
 */
export function buildRunReport(db: SqliteDatabase, runId: string): string {
  const store = new TaskStore(db);
  const run = store.getRun(runId);
  const wps = store.listWorkPackages(runId);
  const passed = wps.filter((w) => w.state === 'passed' || w.state === 'shipped');
  const coveragePct = wps.length ? Math.round((passed.length / wps.length) * 100) : 0;
  const usage = store.usageRollup(runId);
  const openGates = new GateStore(db).list({ status: 'open' }).length;
  const openQuestions = new QuestionStore(db).list({ status: 'open', runId }).length;

  const lines = [
    `# Modernization report — ${run?.project ?? '?'}`,
    '',
    `Run \`${runId}\` · status ${run?.status ?? '?'}`,
    '',
    `- **Coverage:** ${passed.length} / ${wps.length} screens passed (${coveragePct}%)`,
    `- **Spend:** ${usage.inputTokens + usage.outputTokens} tokens over ${usage.attempts} attempt(s)`,
    `- **Inbox:** ${openGates} open gate(s), ${openQuestions} open question(s)`,
    '',
    '## Screens',
    '',
    '| Screen | State | Best diff | Attempts |',
    '| ------ | ----- | --------- | -------- |',
  ];
  for (const wp of wps) {
    const best = store.bestEval(wp.id);
    const diff = best?.visualPct == null ? '—' : `${best.visualPct.toFixed(2)}%`;
    const attempts = store.listAttempts(wp.id).length;
    lines.push(`| ${wp.screenKey ?? wp.title} | ${wp.state} | ${diff} | ${attempts} |`);
  }
  lines.push('');
  return lines.join('\n');
}
