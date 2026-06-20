/**
 * The Setup wizard's pure logic: turn the collected inputs into a schema-valid loom.config.yaml,
 * and guard the env-var-NAME fields against a user pasting the actual secret/URL. Kept out of the
 * component so it's unit-tested directly.
 */

/** The setup inputs the wizard collects. `apiKeyEnv`/`baseUrlEnv` are env-var NAMES, not values. */
export type SetupData = {
  projectName: string;
  appType: string;
  strutsConfig: string;
  baseUrl: string;
  startPath: string;
  provider: string;
  model: string;
  apiKeyEnv: string;
  baseUrlEnv: string;
};

/** Build a schema-valid loom.config.yaml from the inputs (source/app/crawl omitted until provided). */
export function genConfig(d: SetupData): string {
  const lines = [
    `project: ${d.projectName || 'my-app'}`,
    `llm:`,
    `  driver: ${d.provider}`,
    `  model: ${d.model || 'gpt-5.4'}`,
    `  apiKeyEnv: ${d.apiKeyEnv || 'LLM_API_KEY'}`,
  ];
  if (d.baseUrlEnv.trim()) lines.push(`  baseUrlEnv: ${d.baseUrlEnv}`);
  if (d.strutsConfig.trim()) lines.push(`source:`, `  strutsConfig: ${d.strutsConfig}`);
  if (d.baseUrl.trim()) lines.push(`app:`, `  baseUrl: ${d.baseUrl}`);
  if (d.startPath.trim()) lines.push(`crawl:`, `  startPath: ${d.startPath}`);
  return lines.join('\n');
}

/**
 * True when a value looks like an actual secret/URL pasted into an env-var-NAME field (contains a
 * scheme, whitespace, an `sk-` key prefix, or is implausibly long for a variable name). Drives an
 * inline "enter the NAME, not the value" warning so a key never lands in the config file.
 */
export function looksLikeValueNotName(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /:\/\//.test(t) || /\s/.test(t) || /^sk-/i.test(t) || t.length > 40;
}
