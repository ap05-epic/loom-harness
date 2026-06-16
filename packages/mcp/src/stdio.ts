import type { Readable, Writable } from 'node:stream';
import type { Transport } from './transport.js';

/**
 * A {@link Transport} over newline-delimited JSON on a pair of streams — the
 * standard MCP stdio framing, for talking to an external server child process
 * (its stdin/stdout). Inbound bytes are buffered until a full `\n`-terminated
 * line is available; blank and non-JSON lines are ignored (stray log output).
 */
export function stdioTransport(input: Readable, output: Writable): Transport {
  let handler: ((m: unknown) => void) | undefined;
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        try {
          handler?.(JSON.parse(line));
        } catch {
          // not a JSON frame — MCP sends one JSON object per line; ignore the rest
        }
      }
      nl = buffer.indexOf('\n');
    }
  });
  return {
    send: (message) => {
      output.write(`${JSON.stringify(message)}\n`);
    },
    onMessage: (h) => {
      handler = h;
    },
    close: () => {
      handler = undefined;
    },
  };
}
