import type { LlmGateway, LlmRequest, LlmResponse } from '@loom/agents';
import type { ChooserContext } from '@loom/surveyor';
import { describe, expect, test } from 'vitest';
import { buildChoosePrompt, llmChooser, parseChoice } from './llm-chooser.js';

/** A gateway whose one completion returns a scripted reply. */
function gatewayReturning(content: string | null): LlmGateway {
  return {
    complete: async (): Promise<LlmResponse> => ({
      content,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: 'stop',
    }),
  };
}

const ctx: ChooserContext = {
  url: 'http://app/',
  dom: { tag: 'body', attrs: {}, children: [] },
  candidates: [
    { ref: 'c0', label: 'Delete', kind: 'button' },
    { ref: 'c1', label: 'Accounts', kind: 'menuitem' },
    { ref: 'c2', label: 'Search', kind: 'textbox' },
  ],
  visitedKeys: new Set(['k0']),
};

describe('parseChoice', () => {
  test('parses a click action, tolerating prose around the JSON', () => {
    expect(parseChoice('{"action":"click","ref":"c1"}', ['c0', 'c1', 'c2'])).toEqual({
      kind: 'click',
      ref: 'c1',
    });
    expect(parseChoice('I think {"action":"click","ref":"c0"} is best', ['c0', 'c1'])).toEqual({
      kind: 'click',
      ref: 'c0',
    });
  });
  test('parses a fill action and passes a $secret value through unvalidated', () => {
    expect(parseChoice('{"action":"fill","ref":"c2","value":"$user"}', ['c2'])).toEqual({
      kind: 'fill',
      ref: 'c2',
      value: '$user',
    });
    expect(parseChoice('{"action":"fill","ref":"c2","value":"hello"}', ['c2'])).toEqual({
      kind: 'fill',
      ref: 'c2',
      value: 'hello',
    });
  });
  test('folds a submit action into a click', () => {
    expect(parseChoice('{"action":"submit","ref":"c1"}', ['c1'])).toEqual({
      kind: 'click',
      ref: 'c1',
    });
  });
  test('returns null to backtrack, and rejects a hallucinated or malformed reply', () => {
    expect(parseChoice('{"action":null}', ['c0', 'c1'])).toBeNull();
    expect(parseChoice('{"action":"click","ref":"c9"}', ['c0', 'c1'])).toBeNull(); // not a real candidate
    expect(parseChoice('no json here', ['c0', 'c1'])).toBeNull();
    expect(parseChoice(null, ['c0', 'c1'])).toBeNull();
  });
});

describe('buildChoosePrompt', () => {
  test('lists fillable + clickable controls, the secret refs, and steers away from destructive actions', () => {
    const msgs = buildChoosePrompt(ctx, ['user', 'pass', 'fa']);
    const system = msgs.find((m) => m.role === 'system')!.content as string;
    const user = msgs.find((m) => m.role === 'user')!.content as string;
    const sysLower = system.toLowerCase();
    expect(sysLower).toContain('delete'); // names destructive actions to avoid
    expect(sysLower).toContain('login'); // the login strategy
    expect(sysLower).toContain('quick search'); // the FA-search strategy
    expect(system).toContain('$user'); // secret placeholders offered by name…
    expect(system).toContain('$fa');
    expect(user).toContain('c1: Accounts'); // a clickable control
    expect(user).toContain('c2: Search'); // the textbox, listed separately
    expect(user).toContain('1 screens'); // visited count surfaced
  });

  test('surfaces the whole-session history so it stops re-searching / re-clicking (anti-loop)', () => {
    const withHistory: ChooserContext = {
      ...ctx,
      history: [
        { action: { kind: 'fill', ref: 'c9', value: '$fa' }, label: 'Quick Search' },
        { action: { kind: 'click', ref: 'c8' }, label: 'Business Analysis Home' },
      ],
    };
    const msgs = buildChoosePrompt(withHistory, ['user', 'pass', 'fa']);
    const system = (msgs.find((m) => m.role === 'system')!.content as string).toLowerCase();
    const user = msgs.find((m) => m.role === 'user')!.content as string;
    expect(user).toMatch(/this session/i); // the session-scoped done-list is shown
    expect(user).toContain('Quick Search'); // the FA fill recalled by its LABEL (refs differ per screen)
    expect(user).toContain('$fa'); // recorded as the placeholder, never a real value
    expect(user).toContain('Business Analysis Home'); // the menu it already opened
    expect(system).toMatch(/once per session|persist/i); // FA search framed as a one-time action
  });

  test('surfaces the actions already taken on this screen so the model does the next step', () => {
    const withTaken: ChooserContext = {
      ...ctx,
      taken: [{ kind: 'fill', ref: 'c2', value: '$user' }],
    };
    const msgs = buildChoosePrompt(withTaken, ['user', 'pass']);
    const system = (msgs.find((m) => m.role === 'system')!.content as string).toLowerCase();
    const user = msgs.find((m) => m.role === 'user')!.content as string;
    expect(user).toMatch(/already done|filled c2/i); // the done-list is shown…
    expect(user).toContain('c2'); // …naming the field it already filled
    expect(system).toMatch(/next step|do ?n['o]t repeat|already (done|taken)/); // …and told not to repeat
  });
});

describe('llmChooser', () => {
  test('asks the model and returns its chosen action', async () => {
    const chooser = llmChooser(gatewayReturning('{"action":"click","ref":"c1"}'), 'gpt-5.4');
    expect(await chooser(ctx)).toEqual({ kind: 'click', ref: 'c1' });
  });
  test('offers the available secret refs in the prompt (never their values)', async () => {
    let seen: LlmRequest | undefined;
    const gw: LlmGateway = {
      complete: async (req) => {
        seen = req;
        return {
          content: '{"action":"fill","ref":"c2","value":"$user"}',
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'stop',
        };
      },
    };
    const action = await llmChooser(gw, 'gpt-5.4', ['user'])(ctx);
    expect(action).toEqual({ kind: 'fill', ref: 'c2', value: '$user' });
    const sys = seen!.messages.find((m) => m.role === 'system')!.content as string;
    expect(sys).toContain('$user');
  });
  test('returns null (backtrack) on an empty candidate list without calling the model', async () => {
    let called = false;
    const gw: LlmGateway = {
      complete: async () => {
        called = true;
        return {
          content: '{"action":"click","ref":"c0"}',
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'stop',
        };
      },
    };
    expect(await llmChooser(gw, 'gpt-5.4')({ ...ctx, candidates: [] })).toBeNull();
    expect(called).toBe(false);
  });
});
