export type TokenizerFamily = 'o200k' | 'anthropic' | 'unknown';

export type ModelProfile = {
  contextWindow: number;
  maxOutput: number;
  vision: boolean;
  tokenizer: TokenizerFamily;
};

export type ModelProfileOverrides = Partial<ModelProfile>;

type FamilyRule = {
  matches: (normalizedId: string) => boolean;
  profile: ModelProfile;
};

/**
 * Known model families. Order matters — first match wins. These are defaults;
 * profile config can override any field (e.g. opting into GPT-5.4's 1.05M window).
 */
const FAMILIES: FamilyRule[] = [
  {
    matches: (id) => id.includes('5.4'),
    profile: { contextWindow: 272_000, maxOutput: 128_000, vision: true, tokenizer: 'o200k' },
  },
  {
    matches: (id) => id.includes('gpt') || id.startsWith('o'),
    profile: { contextWindow: 200_000, maxOutput: 64_000, vision: true, tokenizer: 'o200k' },
  },
  {
    matches: (id) => id.includes('claude'),
    profile: { contextWindow: 200_000, maxOutput: 64_000, vision: true, tokenizer: 'anthropic' },
  },
];

const FALLBACK: ModelProfile = {
  contextWindow: 128_000,
  maxOutput: 16_000,
  vision: false,
  tokenizer: 'unknown',
};

/** Resolve a model id (possibly provider-prefixed) to its capability profile. */
export function resolveModelProfile(
  modelId: string,
  overrides: ModelProfileOverrides = {},
): ModelProfile {
  const normalized = modelId.toLowerCase();
  const family = FAMILIES.find((f) => f.matches(normalized));
  return { ...(family?.profile ?? FALLBACK), ...overrides };
}
