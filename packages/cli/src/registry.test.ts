import { describe, expect, test } from 'vitest';
import { CommandRegistry, defineCommand } from './registry.js';

const noop = defineCommand({
  name: 'doctor',
  group: 'lifecycle',
  describe: 'check the environment',
  run: () => ({ ok: true }),
});

describe('defineCommand', () => {
  test('returns a spec and always includes OK in documented exit codes', () => {
    expect(noop.name).toBe('doctor');
    expect(noop.group).toBe('lifecycle');
    expect(noop.exitCodes).toContain('OK');
  });

  test('preserves explicitly documented exit codes', () => {
    const spec = defineCommand({
      name: 'build',
      group: 'pipeline',
      describe: 'build screens',
      exitCodes: ['BUDGET_EXHAUSTED', 'GATE_REQUIRED'],
      run: () => null,
    });
    expect(spec.exitCodes).toEqual(
      expect.arrayContaining(['OK', 'BUDGET_EXHAUSTED', 'GATE_REQUIRED']),
    );
  });

  test('rejects an empty name', () => {
    expect(() =>
      defineCommand({ name: '', group: 'lifecycle', describe: 'x', run: () => null }),
    ).toThrow();
  });

  test('captures declared options and args for conformance/flag-coverage checks', () => {
    const spec = defineCommand({
      name: 'profile show',
      group: 'lifecycle',
      describe: 'show profile',
      options: [{ flags: '--redact', describe: 'hide secrets' }],
      args: [{ name: 'name', describe: 'profile name', required: false }],
      run: () => null,
    });
    expect(spec.options?.[0]?.flags).toBe('--redact');
    expect(spec.args?.[0]?.name).toBe('name');
  });
});

describe('CommandRegistry', () => {
  test('add + get + all', () => {
    const reg = new CommandRegistry();
    reg.add(noop);
    expect(reg.get('doctor')).toBe(noop);
    expect(reg.all()).toHaveLength(1);
  });

  test('get returns undefined for unknown', () => {
    expect(new CommandRegistry().get('nope')).toBeUndefined();
  });

  test('rejects duplicate command names', () => {
    const reg = new CommandRegistry();
    reg.add(noop);
    expect(() => reg.add(noop)).toThrow(/duplicate/i);
  });

  test('all() returns commands grouped query helper by group', () => {
    const reg = new CommandRegistry();
    reg.add(noop);
    reg.add(defineCommand({ name: 'map', group: 'pipeline', describe: 'map', run: () => null }));
    expect(reg.byGroup('pipeline').map((c) => c.name)).toEqual(['map']);
  });
});
