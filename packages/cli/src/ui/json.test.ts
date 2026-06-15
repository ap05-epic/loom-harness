import { describe, expect, test } from 'vitest';
import { HarnessError } from '../errors.js';
import { errorEnvelope, successEnvelope } from './json.js';

describe('successEnvelope', () => {
  test('wraps data with ok:true and the command name', () => {
    expect(successEnvelope('wp.list', [{ id: 'wp_1' }])).toEqual({
      ok: true,
      command: 'wp.list',
      data: [{ id: 'wp_1' }],
      warnings: [],
    });
  });

  test('includes warnings when provided', () => {
    expect(successEnvelope('x', null, ['heads up']).warnings).toEqual(['heads up']);
  });
});

describe('errorEnvelope', () => {
  test('serializes a HarnessError into the error envelope', () => {
    const e = new HarnessError({
      code: 'GATE_REQUIRED',
      exitCode: 4,
      message: 'gate open',
      hint: 'approve it',
      docs: 'http://x',
    });
    expect(errorEnvelope('build', e)).toEqual({
      ok: false,
      command: 'build',
      error: { code: 'GATE_REQUIRED', message: 'gate open', hint: 'approve it', docs: 'http://x' },
    });
  });

  test('omits absent optional fields', () => {
    const e = new HarnessError({ code: 'RUNTIME', message: 'boom' });
    expect(errorEnvelope('x', e).error).toEqual({ code: 'RUNTIME', message: 'boom' });
  });
});
