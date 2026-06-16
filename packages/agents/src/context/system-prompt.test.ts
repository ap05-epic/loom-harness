import { describe, expect, test } from 'vitest';
import { buildSystemPrompt, LOOM_IDENTITY, LOOM_SAFEGUARDS } from './system-prompt.js';

describe('buildSystemPrompt (cache-stable bootstrap)', () => {
  test('is byte-stable across calls — no timestamps or volatile content', () => {
    expect(buildSystemPrompt('Rebuild the login screen.')).toBe(
      buildSystemPrompt('Rebuild the login screen.'),
    );
  });

  test('shares one identity + safeguards prefix across every role (the cacheable span)', () => {
    const preamble = `${LOOM_IDENTITY}\n\n# Safeguards\n${LOOM_SAFEGUARDS}\n\n# Your task\n`;
    expect(buildSystemPrompt('Rebuild the screen.').startsWith(preamble)).toBe(true);
    expect(buildSystemPrompt('Fix the failing screen.').startsWith(preamble)).toBe(true);
  });

  test('carries the role instructions after the shared preamble', () => {
    expect(buildSystemPrompt('Reflect on the passed screen.')).toContain(
      'Reflect on the passed screen.',
    );
  });

  test('embeds the core safeguards (protected output + judge trust)', () => {
    const p = buildSystemPrompt('x').toLowerCase();
    expect(p).toContain('rebuild output root');
    expect(p).toContain('evaluator');
  });

  test('a custom identity/safeguards still assembles deterministically', () => {
    const a = buildSystemPrompt('do x', { identity: 'I', safeguards: 'S' });
    expect(a).toBe('I\n\n# Safeguards\nS\n\n# Your task\ndo x');
  });
});
