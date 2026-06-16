import { judgePanel, type LlmGateway } from '@loom/agents';
import type { CodeAtlas } from './codeatlas.js';
import { screenEvidence } from './summarize.js';

/** One screen's recovered-doc verdict from the consensus panel. */
export type DocVerification = {
  screenKey: string;
  verdict: 'pass' | 'fail';
  votes: { ok: number; total: number };
  /** The dissenting judges' reasons — why the doc was rejected. */
  reasons: string[];
};

export type VerifyDocsResult = {
  /** How many recovered docs were put to the panel. */
  verified: number;
  /** The docs the panel voted down — candidates for regeneration or human review. */
  flagged: DocVerification[];
};

export type VerifyDocsOptions = {
  gateway: LlmGateway;
  model: string;
  /** Judges per doc (default 3). */
  judges?: number;
  /** Required approving fraction (default: a strict majority). */
  quorum?: number;
  maxTokensPerJudge?: number;
};

/**
 * Adversarially verify the **recovered documentation** with the consensus panel: for every
 * screen that has a generated doc, run a skeptical judge panel that checks the doc against the
 * same atlas facts it was generated from, and flag the ones the panel votes down. This is the
 * subjective check the deterministic evaluator can't make — it catches a doc that *reads* fine
 * but claims something the source never had. The 7-layer parity evaluator is untouched.
 */
export async function verifyScreenDocs(
  atlas: CodeAtlas,
  opts: VerifyDocsOptions,
): Promise<VerifyDocsResult> {
  const flagged: DocVerification[] = [];
  let verified = 0;
  for (const screen of atlas.screens()) {
    const slice = atlas.sliceForScreen(screen.key);
    if (!slice) continue;
    const doc = atlas.getNodeDoc(slice.action.id);
    if (!doc) continue;
    const panel = await judgePanel(opts.gateway, {
      model: opts.model,
      subject: 'recovered documentation',
      claim: doc,
      evidence: screenEvidence(atlas, screen),
      judges: opts.judges,
      quorum: opts.quorum,
      maxTokensPerJudge: opts.maxTokensPerJudge,
    });
    verified += 1;
    if (panel.verdict === 'fail') {
      flagged.push({
        screenKey: screen.key,
        verdict: panel.verdict,
        votes: panel.votes,
        reasons: panel.judgements
          .filter((j) => !j.ok)
          .map((j) => j.reason)
          .filter(Boolean),
      });
    }
  }
  return { verified, flagged };
}
