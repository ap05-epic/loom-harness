import { describe, expect, test } from 'vitest';
import { resolveOutputMode, type OutputModeInputs } from './tty.js';

const base: OutputModeInputs = {
  flags: {},
  env: {},
  stdoutTTY: true,
  stdinTTY: true,
};

describe('resolveOutputMode', () => {
  test('default interactive terminal: color on, interactive on, spinner on', () => {
    const m = resolveOutputMode(base);
    expect(m).toMatchObject({ json: false, color: true, interactive: true, spinner: true });
  });

  test('--json forces no color, not interactive, no spinner', () => {
    const m = resolveOutputMode({ ...base, flags: { json: true } });
    expect(m).toMatchObject({ json: true, color: false, interactive: false, spinner: false });
  });

  test('NO_COLOR env disables color but keeps interactivity', () => {
    const m = resolveOutputMode({ ...base, env: { NO_COLOR: '1' } });
    expect(m.color).toBe(false);
    expect(m.interactive).toBe(true);
  });

  test('--no-color flag disables color', () => {
    expect(resolveOutputMode({ ...base, flags: { noColor: true } }).color).toBe(false);
  });

  test('CI disables interactivity but not color', () => {
    const m = resolveOutputMode({ ...base, env: { CI: 'true' } });
    expect(m.interactive).toBe(false);
    expect(m.color).toBe(true);
  });

  test('--no-input disables interactivity', () => {
    expect(resolveOutputMode({ ...base, flags: { noInput: true } }).interactive).toBe(false);
  });

  test('non-TTY stdin disables interactivity', () => {
    expect(resolveOutputMode({ ...base, stdinTTY: false }).interactive).toBe(false);
  });

  test('non-TTY stdout disables spinner and color', () => {
    const m = resolveOutputMode({ ...base, stdoutTTY: false });
    expect(m.spinner).toBe(false);
    expect(m.color).toBe(false);
  });

  test('FORCE_COLOR forces color through a pipe (non-TTY stdout)', () => {
    const m = resolveOutputMode({ ...base, stdoutTTY: false, env: { FORCE_COLOR: '1' } });
    expect(m.color).toBe(true);
  });

  test('FORCE_COLOR does not override --json', () => {
    const m = resolveOutputMode({ ...base, flags: { json: true }, env: { FORCE_COLOR: '1' } });
    expect(m.color).toBe(false);
  });

  test('quiet and verbose pass through', () => {
    const m = resolveOutputMode({ ...base, flags: { quiet: true, verbose: 2 } });
    expect(m.quiet).toBe(true);
    expect(m.verbose).toBe(2);
  });
});
