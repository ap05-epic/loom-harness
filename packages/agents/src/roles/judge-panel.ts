import type { ChatMessage, LlmGateway } from '../types.js';
import { extractJsonObject } from './json.js';

/** One judge's adjudication of a claim against the evidence. */
export type JudgeVerdict = { ok: boolean; reason: string };

export type PanelResult = {
  /** `pass` only when at least the required number of judges approve. */
  verdict: 'pass' | 'fail';
  votes: { ok: number; total: number };
  judgements: JudgeVerdict[];
};

export type JudgePanelInput = {
  model: string;
  /** The thing to adjudicate — a recovered doc, a plan, an ambiguous parity judgement. */
  claim: string;
  /** The grounding evidence the judges must check the claim against. */
  evidence: string;
  /** What kind of thing is being judged — phrased into the prompt (default `claim`). */
  subject?: string;
  /** Number of independent judges (default 3). */
  judges?: number;
  /** Required approving fraction (default: a strict majority). 1 = unanimity. */
  quorum?: number;
  /** Per-judge output cap. */
  maxTokensPerJudge?: number;
};

/**
 * Lenient parse of one judge's reply. Prefers strict JSON `{ ok, reason }`; when the model
 * doesn't comply, defaults to a **skeptical reject** (`ok: false`) — an unparseable judge must
 * never count as approval on an adversarial panel.
 */
export function parseVerdict(content: string | null): JudgeVerdict {
  const obj = (content ? extractJsonObject(content) : null) as Record<string, unknown> | null;
  if (obj && typeof obj.ok === 'boolean') {
    return { ok: obj.ok, reason: typeof obj.reason === 'string' ? obj.reason.trim() : '' };
  }
  return { ok: false, reason: (content ?? '').trim().slice(0, 200) };
}

/** The adversarial judge prompt — skeptical, evidence-bound, strict-JSON. */
export function buildJudgePrompt(input: {
  subject?: string;
  claim: string;
  evidence: string;
}): ChatMessage[] {
  const subject = input.subject ?? 'claim';
  return [
    {
      role: 'system',
      content:
        `You are an adversarial reviewer on a verification panel. Decide whether the ${subject} ` +
        'below is fully and accurately supported by the evidence. Be skeptical: if any part is ' +
        'unsupported, contradicted, or overstated, the verdict is false. Judge ONLY against the ' +
        'evidence given — assume no facts not present. Respond with STRICT JSON only, no prose:\n' +
        '{"ok": true|false, "reason": "one sentence"}',
    },
    {
      role: 'user',
      content: `## The ${subject} to verify\n${input.claim}\n\n## Evidence\n${input.evidence}`,
    },
  ];
}

/**
 * A cost-bounded consensus panel for the **subjective** calls the deterministic 7-layer
 * evaluator can't make — recovered-doc accuracy, plan quality, ambiguous parity. It runs N
 * independent, skeptical judges over the same claim+evidence and returns a quorum verdict.
 * The deterministic evaluator stays the source of truth for visual/structural/behavioral
 * parity; this panel only adjudicates judgement calls, and it defaults to rejecting on doubt.
 */
export async function judgePanel(
  gateway: LlmGateway,
  input: JudgePanelInput,
): Promise<PanelResult> {
  const total = Math.max(1, input.judges ?? 3);
  const messages = buildJudgePrompt(input);
  const judgements = await Promise.all(
    Array.from({ length: total }, () =>
      gateway
        .complete({ model: input.model, messages, maxTokens: input.maxTokensPerJudge })
        .then((r) => parseVerdict(r.content)),
    ),
  );
  const ok = judgements.filter((j) => j.ok).length;
  const needed =
    input.quorum !== undefined
      ? Math.max(1, Math.ceil(input.quorum * total))
      : Math.floor(total / 2) + 1; // strict majority by default
  return { verdict: ok >= needed ? 'pass' : 'fail', votes: { ok, total }, judgements };
}
