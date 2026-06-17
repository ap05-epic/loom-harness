import { describe, expect, test } from 'vitest';
import {
  createPolicy,
  decidePermission,
  permissionHook,
  type PermissionAnswer,
  type ToolRisk,
} from './permissions.js';

describe('decidePermission', () => {
  const cases: Array<[ToolRisk, 'ask' | 'auto' | 'allow-all' | 'deny', 'allow' | 'ask' | 'deny']> =
    [
      // reads run free except under a blanket deny
      ['read', 'ask', 'allow'],
      ['read', 'auto', 'allow'],
      ['read', 'allow-all', 'allow'],
      ['read', 'deny', 'deny'],
      // safe: auto frees it, ask prompts, allow-all frees it
      ['safe', 'ask', 'ask'],
      ['safe', 'auto', 'allow'],
      ['safe', 'allow-all', 'allow'],
      // expensive: only allow-all frees it
      ['expensive', 'ask', 'ask'],
      ['expensive', 'auto', 'ask'],
      ['expensive', 'allow-all', 'allow'],
      ['expensive', 'deny', 'deny'],
    ];
  test.each(cases)('risk=%s mode=%s → %s', (risk, mode, expected) => {
    expect(decidePermission(createPolicy(mode), { name: 't', risk })).toBe(expected);
  });

  test('the per-tool deny list wins over everything', () => {
    const p = createPolicy('allow-all');
    p.deny.add('danger');
    expect(decidePermission(p, { name: 'danger', risk: 'read' })).toBe('deny');
  });

  test('the per-tool allow list frees an otherwise-prompted tool', () => {
    const p = createPolicy('ask');
    p.allow.add('blessed');
    expect(decidePermission(p, { name: 'blessed', risk: 'expensive' })).toBe('allow');
  });
});

describe('permissionHook (PreToolUse)', () => {
  const riskOf = (name: string): ToolRisk =>
    name === 'read_thing' ? 'read' : name === 'safe_thing' ? 'safe' : 'expensive';

  function hookWith(mode: 'ask' | 'auto' | 'allow-all' | 'deny', answer: PermissionAnswer) {
    const policy = createPolicy(mode);
    const prompts: string[] = [];
    const hook = permissionHook(policy, riskOf, (req) => {
      prompts.push(req.name);
      return answer;
    });
    return { policy, prompts, hook };
  }

  test('an allowed tool is not blocked and never prompts', async () => {
    const { hook, prompts } = hookWith('allow-all', 'no');
    expect(await hook({ name: 'expensive_thing', input: {} })).toBeUndefined();
    expect(prompts).toEqual([]);
  });

  test('deny mode blocks with a reason', async () => {
    const { hook } = hookWith('deny', 'yes');
    const d = await hook({ name: 'expensive_thing', input: {} });
    expect(d).toMatchObject({ block: true });
  });

  test('ask + "yes" allows once without remembering', async () => {
    const { hook, policy, prompts } = hookWith('ask', 'yes');
    expect(await hook({ name: 'expensive_thing', input: {} })).toBeUndefined();
    expect(prompts).toEqual(['expensive_thing']);
    expect(policy.allow.has('expensive_thing')).toBe(false);
  });

  test('ask + "no" blocks', async () => {
    const { hook } = hookWith('ask', 'no');
    expect(await hook({ name: 'expensive_thing', input: {} })).toMatchObject({ block: true });
  });

  test('ask + "always" allows and remembers the tool for the session', async () => {
    const { hook, policy } = hookWith('ask', 'always');
    expect(await hook({ name: 'expensive_thing', input: {} })).toBeUndefined();
    expect(policy.allow.has('expensive_thing')).toBe(true);
  });

  test('ask + "all" allows and flips the whole policy to allow-all', async () => {
    const { hook, policy } = hookWith('ask', 'all');
    expect(await hook({ name: 'expensive_thing', input: {} })).toBeUndefined();
    expect(policy.mode).toBe('allow-all');
  });
});
