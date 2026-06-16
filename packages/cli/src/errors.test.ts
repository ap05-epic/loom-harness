import { describe, expect, test } from 'vitest';
import { EXIT, HarnessError, configError, mapError, notFoundError, usageError } from './errors.js';

describe('HarnessError', () => {
  test('carries code, exitCode, message, hint, docs', () => {
    const e = new HarnessError({
      code: 'GATE_REQUIRED',
      exitCode: EXIT.GATE_REQUIRED,
      message: 'waiting on a ship gate',
      hint: 'run harness gates approve',
      docs: 'https://x/docs#gates',
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('GATE_REQUIRED');
    expect(e.exitCode).toBe(4);
    expect(e.message).toBe('waiting on a ship gate');
    expect(e.hint).toBe('run harness gates approve');
    expect(e.docs).toBe('https://x/docs#gates');
  });

  test('defaults exitCode to RUNTIME when not given', () => {
    const e = new HarnessError({ code: 'WHATEVER', message: 'boom' });
    expect(e.exitCode).toBe(EXIT.RUNTIME);
  });
});

describe('factory helpers', () => {
  test('usageError → code USAGE, exit 2', () => {
    const e = usageError('bad flag', 'see --help');
    expect(e.code).toBe('USAGE');
    expect(e.exitCode).toBe(2);
    expect(e.hint).toBe('see --help');
  });

  test('configError → code CONFIG, exit 3', () => {
    expect(configError('no profile').exitCode).toBe(3);
  });

  test('notFoundError → code NOT_FOUND, exit 9', () => {
    const e = notFoundError('work package', 'wp_999');
    expect(e.exitCode).toBe(9);
    expect(e.message).toMatch(/wp_999/);
  });
});

describe('mapError', () => {
  test('passes a HarnessError through unchanged', () => {
    const original = usageError('x');
    expect(mapError(original)).toBe(original);
  });

  test('maps the config-loader git-tree refusal to CONFIG', () => {
    const e = mapError(new Error('Data dir /x is inside a git working tree.'));
    expect(e.code).toBe('CONFIG');
    expect(e.exitCode).toBe(3);
  });

  test('maps a missing-config error to CONFIG', () => {
    const e = mapError(new Error('No harness.config.yaml found in /x'));
    expect(e.exitCode).toBe(3);
  });

  test('wraps an unknown throwable as INTERNAL (exit 70) preserving cause', () => {
    const boom = new Error('totally unexpected');
    const e = mapError(boom);
    expect(e.code).toBe('INTERNAL');
    expect(e.exitCode).toBe(70);
    expect(e.cause).toBe(boom);
  });

  test('wraps a non-Error throwable', () => {
    const e = mapError('a string was thrown');
    expect(e.exitCode).toBe(70);
    expect(e.message).toMatch(/a string was thrown/);
  });
});
