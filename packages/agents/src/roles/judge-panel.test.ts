import { describe, expect, test } from 'vitest';
import type { LlmGateway } from '../types.js';
import { buildJudgePrompt, judgePanel, parseVerdict } from './judge-panel.js';

/** A gateway that returns each queued content in turn (clamped to the last) — one per judge. */
const queueGateway = (contents: Array<string | null>): LlmGateway => {
  let i = 0;
  return {
    complete: async () => ({
      content: contents[Math.min(i++, contents.length - 1)] ?? null,
      toolCalls: [],
      usage: { inputTokens: 5, outputTokens: 5 },
      finishReason: 'stop',
    }),
  };
};

describe('judgePanel', () => {
  test('catches a subtly-wrong recovered doc — the panel votes fail', async () => {
    // The doc claims a "remember me" checkbox the source never had.
    const gateway = queueGateway([
      JSON.stringify({ ok: false, reason: 'claims a remember-me checkbox absent from the source' }),
      JSON.stringify({ ok: false, reason: 'no such control in the JSP' }),
      JSON.stringify({ ok: false, reason: 'overstated; unsupported by the evidence' }),
    ]);
    const res = await judgePanel(gateway, {
      model: 'm',
      subject: 'recovered documentation',
      claim: 'The login screen has username, password, and a "remember me" checkbox.',
      evidence: 'JSP: <input name=username><input name=password type=password><submit>',
    });
    expect(res.verdict).toBe('fail');
    expect(res.votes).toEqual({ ok: 0, total: 3 });
    expect(res.judgements).toHaveLength(3);
  });

  test('passes an accurate doc when a quorum of judges approve (majority)', async () => {
    const gateway = queueGateway([
      JSON.stringify({ ok: true, reason: 'matches the source' }),
      JSON.stringify({ ok: true, reason: 'accurate' }),
      JSON.stringify({ ok: false, reason: 'minor nit' }), // one dissent
    ]);
    const res = await judgePanel(gateway, {
      model: 'm',
      claim: 'The login screen has username and password fields.',
      evidence: '<input name=username><input name=password>',
    });
    expect(res.verdict).toBe('pass'); // 2/3 majority
    expect(res.votes.ok).toBe(2);
  });

  test('a higher quorum makes the panel stricter', async () => {
    const split = (): LlmGateway =>
      queueGateway([
        JSON.stringify({ ok: true, reason: 'y' }),
        JSON.stringify({ ok: true, reason: 'y' }),
        JSON.stringify({ ok: false, reason: 'n' }),
      ]);
    // default majority (needs 2 of 3): 2/3 → pass
    expect((await judgePanel(split(), { model: 'm', claim: 'c', evidence: 'e' })).verdict).toBe(
      'pass',
    );
    // unanimity required (quorum 1.0, needs 3 of 3): 2/3 → fail
    expect(
      (await judgePanel(split(), { model: 'm', claim: 'c', evidence: 'e', quorum: 1 })).verdict,
    ).toBe('fail');
  });

  test('parseVerdict prefers strict JSON and defaults skeptical (reject) when unparseable', () => {
    expect(parseVerdict(JSON.stringify({ ok: true, reason: 'fine' }))).toEqual({
      ok: true,
      reason: 'fine',
    });
    expect(parseVerdict('I think it is probably fine?').ok).toBe(false);
    expect(parseVerdict(null).ok).toBe(false);
  });

  test('buildJudgePrompt is skeptical, demands JSON, and carries the claim + evidence', () => {
    const msgs = buildJudgePrompt({ subject: 'plan', claim: 'CLAIM-X', evidence: 'EVIDENCE-Y' });
    const all = msgs.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    expect(all.toLowerCase()).toContain('skeptical');
    expect(all.toLowerCase()).toContain('json');
    expect(all).toContain('CLAIM-X');
    expect(all).toContain('EVIDENCE-Y');
    expect(all).toContain('plan');
  });
});
