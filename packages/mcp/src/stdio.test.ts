import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { stdioTransport } from './index.js';

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('stdioTransport', () => {
  test('parses inbound newline-delimited JSON and frames outbound messages', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const transport = stdioTransport(input, output);

    const received: unknown[] = [];
    transport.onMessage((m) => received.push(m));
    const out: string[] = [];
    output.on('data', (c: Buffer) => out.push(c.toString()));

    input.write(`${JSON.stringify({ a: 1 })}\n`);
    input.write(`${JSON.stringify({ b: 2 })}\n`);
    transport.send({ c: 3 });
    await tick();

    expect(received).toEqual([{ a: 1 }, { b: 2 }]);
    expect(out.join('')).toBe(`${JSON.stringify({ c: 3 })}\n`);
  });

  test('buffers a single message split across chunks', async () => {
    const input = new PassThrough();
    const transport = stdioTransport(input, new PassThrough());
    const received: unknown[] = [];
    transport.onMessage((m) => received.push(m));

    input.write('{"x":');
    input.write('42}\n');
    await tick();

    expect(received).toEqual([{ x: 42 }]);
  });

  test('ignores blank and non-JSON lines (e.g. stray log output)', async () => {
    const input = new PassThrough();
    const transport = stdioTransport(input, new PassThrough());
    const received: unknown[] = [];
    transport.onMessage((m) => received.push(m));

    input.write('\n');
    input.write('not json\n');
    input.write(`${JSON.stringify({ ok: true })}\n`);
    await tick();

    expect(received).toEqual([{ ok: true }]);
  });
});
