import { createRequire } from 'node:module';
import type { TokenizerFamily } from '../model-profile.js';

const require = createRequire(import.meta.url);

export type TokenCounter = (text: string) => number;

/** chars/4 with a 10% safety margin — a provider-agnostic upper-ish estimate.
 *  Uses integer math (×11/40 ≡ ×1.1/4) to avoid float-rounding artifacts. */
export function heuristicCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil((text.length * 11) / 40);
}

type Encoder = ((text: string) => number) | null;
let o200kEncoder: Encoder | undefined;

function loadO200k(): Encoder {
  if (o200kEncoder !== undefined) return o200kEncoder;
  for (const mod of ['gpt-tokenizer/encoding/o200k_base', 'gpt-tokenizer']) {
    try {
      const tok = require(mod) as { encode: (t: string) => number[] };
      if (typeof tok.encode === 'function') {
        o200kEncoder = (t: string) => tok.encode(t).length;
        return o200kEncoder;
      }
    } catch {
      // try the next candidate
    }
  }
  o200kEncoder = null;
  return o200kEncoder;
}

/**
 * Return a token counter for the model's tokenizer family. Uses gpt-tokenizer
 * for OpenAI-family models when available; otherwise (and for Anthropic/unknown)
 * falls back to the heuristic so the harness never hard-fails on a missing
 * encoder in a locked-down environment.
 */
export function counterFor(family: TokenizerFamily): TokenCounter {
  if (family === 'o200k') {
    const encode = loadO200k();
    if (encode) return (text) => (text.length === 0 ? 0 : encode(text));
  }
  return heuristicCount;
}
