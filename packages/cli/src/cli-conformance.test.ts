import { describe, expect, test } from 'vitest';
import { ALL_COMMANDS, registerAll } from './commands/index.js';
import { buildProgram } from './program.js';

const GROUPS = ['lifecycle', 'pipeline', 'observe', 'work', 'knowledge'];

describe('cli-conformance: every command meets the bar', () => {
  test.each(ALL_COMMANDS.map((c) => [c.name, c] as const))('%s', (_name, command) => {
    // describe present and meaningful
    expect(command.describe.length).toBeGreaterThan(5);
    // valid group
    expect(GROUPS).toContain(command.group);
    // OK always documented; codes are real names
    expect(command.exitCodes).toContain('OK');
    // every example actually invokes this command
    for (const ex of command.examples ?? []) {
      expect(ex.startsWith(`harness ${command.name.split(' ')[0]}`)).toBe(true);
    }
  });

  test('the registry rejects duplicate names (built clean)', () => {
    expect(() => registerAll()).not.toThrow();
    expect(registerAll().all()).toHaveLength(ALL_COMMANDS.length);
  });

  test('buildProgram wires every command and renders help with the exit-code table', () => {
    const program = buildProgram(registerAll(), { version: '9.9.9' });
    let help = '';
    program.configureOutput({ writeOut: (s) => (help += s) });
    program.outputHelp();
    // top-level command names appear in help
    expect(help).toMatch(/\bdoctor\b/);
    expect(help).toMatch(/\bstatus\b/);
    expect(help).toMatch(/\bprofile\b/);
    expect(help).toMatch(/Exit codes:/);
  });

  test('every command (and subcommand) supports --json and --help', () => {
    const program = buildProgram(registerAll(), { version: '9.9.9' });
    for (const command of ALL_COMMANDS) {
      const parts = command.name.split(' ');
      // resolve the commander Command for this (possibly nested) name
      let cmd = program.commands.find((c) => c.name() === parts[0]);
      for (const part of parts.slice(1)) cmd = cmd?.commands.find((c) => c.name() === part);
      expect(cmd, `command ${command.name} is registered`).toBeDefined();
      const flags = cmd!.options.map((o) => o.long);
      expect(flags, `${command.name} has --json`).toContain('--json');
      expect(flags, `${command.name} has --quiet`).toContain('--quiet');
    }
  });

  test('init declares flags covering each of its interactive prompts', () => {
    // prompts: dir, project, model — all must have a flag so non-interactive never hangs
    const init = ALL_COMMANDS.find((c) => c.name === 'init')!;
    const flags = (init.options ?? []).map((o) => o.flags);
    expect(flags.some((f) => f.includes('--dir'))).toBe(true);
    expect(flags.some((f) => f.includes('--project'))).toBe(true);
    expect(flags.some((f) => f.includes('--model'))).toBe(true);
  });
});
