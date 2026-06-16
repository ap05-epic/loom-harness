import type { Memory, MemoryStore } from '@loom/core';
import type { ChatMessage, LlmGateway } from '../types.js';

/**
 * The Run Reflector: at the end of a run/shift, draft a concise recap — progress, recurring failure
 * patterns (candidate skills/fixes), budget/velocity notes — and persist it as a `reflection`
 * memory so the next shift starts informed. The distill half of the self-improvement loop at the
 * run scale (the per-screen Reflector handles skills + facts).
 */

export type RunSummaryInput = {
  project: string;
  runId: string;
  /** A digest of the run: screens shipped/blocked, recurring failure reasons, budget burn. */
  notes: string;
  model: string;
};

/** The recap prompt — grounded on the run, plain prose, no JSON. */
export function buildRunSummaryPrompt(input: { runId: string; notes: string }): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are the Run Reflector. Write a concise recap of this run for the next shift: what ' +
        'progressed, the recurring failure patterns worth turning into skills or fixes, and any ' +
        'budget/velocity observations. Ground it in the data — invent nothing. A few plain-prose ' +
        'sentences; no JSON, no preamble.',
    },
    { role: 'user', content: `Run ${input.runId}\n\n${input.notes}` },
  ];
}

/**
 * Ask the model for the run recap and store it as a `reflection` memory. An empty reply writes
 * nothing (no hollow reflection) and returns `null`.
 */
export async function summarizeRun(
  gateway: LlmGateway,
  memory: MemoryStore,
  input: RunSummaryInput,
): Promise<Memory | null> {
  const res = await gateway.complete({
    model: input.model,
    messages: buildRunSummaryPrompt({ runId: input.runId, notes: input.notes }),
  });
  const body = (res.content ?? '').trim();
  if (!body) return null;
  return memory.remember({
    project: input.project,
    kind: 'reflection',
    title: `Run ${input.runId} reflection`,
    body,
    meta: { runId: input.runId, source: 'run-summary' },
  });
}
