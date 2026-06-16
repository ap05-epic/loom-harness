import type { LlmGateway, LlmResponse } from '@loom/agents';
import { describe, expect, test } from 'vitest';
import { buildMapPrompt, llmAreaMapper, parseAreaMap } from './area-mapper.js';
import type { MapTarget } from './deep-map.js';

const gatewayReturning = (content: string | null): LlmGateway => ({
  complete: async (): Promise<LlmResponse> => ({
    content,
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    finishReason: 'stop',
  }),
});

const target: MapTarget = { id: 'login', kind: 'screen' };

describe('parseAreaMap', () => {
  test('extracts summary, entities, and links (tolerating prose)', () => {
    const content =
      'Here is the map:\n{"summary":"The login screen.","entities":["AuthService"],"links":[{"to":"home","via":"submit"}]}';
    expect(parseAreaMap(content, target)).toEqual({
      id: 'login',
      summary: 'The login screen.',
      entities: ['AuthService'],
      links: [{ to: 'home', via: 'submit' }],
    });
  });

  test('a junk reply degrades to an empty map for the target (never throws)', () => {
    expect(parseAreaMap('no json here', target)).toEqual({
      id: 'login',
      summary: '',
      entities: [],
      links: [],
    });
    expect(parseAreaMap(null, target).id).toBe('login');
  });
});

describe('buildMapPrompt', () => {
  test('grounds on the target + its slice and forbids backend changes', () => {
    const all = buildMapPrompt(target, 'form: user/password; links: /home')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    expect(all).toContain('login');
    expect(all).toContain('form: user/password');
    expect(all.toLowerCase()).toContain('json');
    expect(all.toLowerCase()).toContain('backend'); // documents the no-backend-change rule
  });
});

describe('llmAreaMapper', () => {
  test('maps a target via the model using its per-target slice', async () => {
    const slices: string[] = [];
    const mapTarget = llmAreaMapper(
      gatewayReturning('{"summary":"Login.","entities":["AuthService"],"links":[]}'),
      'gpt-5.4',
      (t) => {
        slices.push(t.id);
        return `slice for ${t.id}`;
      },
    );
    const area = await mapTarget(target, 0);
    expect(area).toMatchObject({ id: 'login', summary: 'Login.', entities: ['AuthService'] });
    expect(slices).toEqual(['login']); // the slice provider was consulted for this target
  });
});
