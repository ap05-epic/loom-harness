import { describe, expect, test } from 'vitest';
import { HarnessError } from '../errors.js';
import { createSink } from './sink.js';
import { resolveOutputMode } from './tty.js';

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    write: (s: string) => stdout.push(s),
    writeErr: (s: string) => stderr.push(s),
  };
}

const humanMode = resolveOutputMode({ flags: {}, env: {}, stdoutTTY: true, stdinTTY: true });
const jsonMode = resolveOutputMode({
  flags: { json: true },
  env: {},
  stdoutTTY: false,
  stdinTTY: false,
});
const quietMode = resolveOutputMode({
  flags: { quiet: true },
  env: {},
  stdoutTTY: true,
  stdinTTY: true,
});

describe('createSink — JSON mode', () => {
  test('flushSuccess prints exactly one envelope to stdout, nothing else', () => {
    const cap = capture();
    const sink = createSink({
      command: 'wp.list',
      mode: jsonMode,
      write: cap.write,
      writeErr: cap.writeErr,
    });
    sink.info('loading…');
    sink.result([{ id: 'wp_1' }]);
    sink.flushSuccess();
    expect(cap.stdout).toHaveLength(1);
    const env = JSON.parse(cap.stdout[0]!);
    expect(env).toMatchObject({ ok: true, command: 'wp.list', data: [{ id: 'wp_1' }] });
  });

  test('diagnostics go to stderr as NDJSON, never stdout', () => {
    const cap = capture();
    const sink = createSink({
      command: 'x',
      mode: jsonMode,
      write: cap.write,
      writeErr: cap.writeErr,
    });
    sink.info('hello');
    sink.warn('careful');
    expect(cap.stdout).toHaveLength(0);
    expect(cap.stderr).toHaveLength(2);
    expect(JSON.parse(cap.stderr[0]!)).toMatchObject({ level: 'info', message: 'hello' });
    expect(JSON.parse(cap.stderr[1]!)).toMatchObject({ level: 'warn', message: 'careful' });
  });

  test('flushError prints an error envelope to stdout', () => {
    const cap = capture();
    const sink = createSink({
      command: 'build',
      mode: jsonMode,
      write: cap.write,
      writeErr: cap.writeErr,
    });
    sink.flushError(new HarnessError({ code: 'GATE_REQUIRED', exitCode: 4, message: 'gate' }));
    expect(cap.stdout).toHaveLength(1);
    expect(JSON.parse(cap.stdout[0]!)).toMatchObject({
      ok: false,
      error: { code: 'GATE_REQUIRED' },
    });
  });
});

describe('createSink — human mode', () => {
  test('result renders via the provided renderer to stdout', () => {
    const cap = capture();
    const sink = createSink({
      command: 'x',
      mode: humanMode,
      write: cap.write,
      writeErr: cap.writeErr,
    });
    sink.result({ n: 2 });
    sink.flushSuccess((data) => sink.line(`count is ${(data as { n: number }).n}`));
    expect(cap.stdout.join('')).toMatch(/count is 2/);
  });

  test('info/warn/error go to stderr; error is prefixed', () => {
    const cap = capture();
    const sink = createSink({
      command: 'x',
      mode: humanMode,
      write: cap.write,
      writeErr: cap.writeErr,
    });
    sink.info('fyi');
    sink.error('nope');
    expect(cap.stdout).toHaveLength(0);
    expect(cap.stderr.join('')).toMatch(/fyi/);
    expect(cap.stderr.join('')).toMatch(/nope/);
  });

  test('quiet suppresses info but not warn/error', () => {
    const cap = capture();
    const sink = createSink({
      command: 'x',
      mode: quietMode,
      write: cap.write,
      writeErr: cap.writeErr,
    });
    sink.info('chatter');
    sink.warn('important');
    expect(cap.stderr.join('')).not.toMatch(/chatter/);
    expect(cap.stderr.join('')).toMatch(/important/);
  });

  test('flushError writes the message and hint to stderr', () => {
    const cap = capture();
    const sink = createSink({
      command: 'x',
      mode: humanMode,
      write: cap.write,
      writeErr: cap.writeErr,
    });
    sink.flushError(
      new HarnessError({
        code: 'CONFIG',
        exitCode: 3,
        message: 'no profile',
        hint: 'run harness init',
      }),
    );
    const err = cap.stderr.join('');
    expect(err).toMatch(/no profile/);
    expect(err).toMatch(/run harness init/);
    expect(cap.stdout).toHaveLength(0);
  });
});
