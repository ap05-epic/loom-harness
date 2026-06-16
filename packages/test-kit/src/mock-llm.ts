import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type RecordedRequest = {
  path: string;
  headers: Record<string, string>;
  body: {
    model?: string;
    messages?: unknown[];
    tools?: unknown[];
    [key: string]: unknown;
  };
};

type ScriptOptions = { repeat?: boolean };

type Scripted =
  | ({ kind: 'text'; content: string } & ScriptOptions)
  | ({ kind: 'tool'; name: string; args: unknown } & ScriptOptions)
  | ({ kind: 'error'; status: number; message: string } & ScriptOptions);

function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(value ?? '').length / 4));
}

/**
 * In-process OpenAI-compatible chat-completions server for tests.
 * Script responses with enqueue*(); inspect what the client sent via `requests`.
 */
export class MockLlmServer {
  readonly requests: RecordedRequest[] = [];
  private queue: Scripted[] = [];
  private repeating?: Scripted;
  private server?: Server;
  private callCounter = 0;

  enqueueText(content: string, options: ScriptOptions = {}): void {
    this.queue.push({ kind: 'text', content, ...options });
  }

  enqueueToolCall(name: string, args: unknown, options: ScriptOptions = {}): void {
    this.queue.push({ kind: 'tool', name, args, ...options });
  }

  enqueueError(status: number, message: string, options: ScriptOptions = {}): void {
    this.queue.push({ kind: 'error', status, message, ...options });
  }

  async start(): Promise<{ port: number; baseUrl: string }> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let body: RecordedRequest['body'] = {};
        try {
          body = rawBody ? (JSON.parse(rawBody) as RecordedRequest['body']) : {};
        } catch {
          // keep empty body on parse failure; the test will see it in `requests`
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers[k.toLowerCase()] = v;
        }
        this.requests.push({ path: req.url ?? '', headers, body });

        const scripted = this.next();
        if (!scripted) {
          this.respondJson(res, 500, {
            error: { message: 'No scripted response in MockLlmServer queue', type: 'mock_error' },
          });
          return;
        }
        if (scripted.kind === 'error') {
          this.respondJson(res, scripted.status, {
            error: { message: scripted.message, type: 'mock_error' },
          });
          return;
        }

        const promptTokens = estimateTokens(body.messages);
        const completion =
          scripted.kind === 'text'
            ? {
                message: { role: 'assistant', content: scripted.content },
                finish_reason: 'stop',
                completionTokens: estimateTokens(scripted.content),
              }
            : {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: `call_${++this.callCounter}`,
                      type: 'function',
                      function: { name: scripted.name, arguments: JSON.stringify(scripted.args) },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
                completionTokens: estimateTokens(scripted.args),
              };

        this.respondJson(res, 200, {
          id: `chatcmpl_mock_${this.requests.length}`,
          object: 'chat.completion',
          model: body.model ?? 'mock',
          choices: [
            { index: 0, message: completion.message, finish_reason: completion.finish_reason },
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completion.completionTokens,
            total_tokens: promptTokens + completion.completionTokens,
          },
        });
      });
    });

    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const port = (this.server.address() as AddressInfo).port;
    return { port, baseUrl: `http://127.0.0.1:${port}/v1` };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server?.close((err) => (err ? reject(err) : resolve())),
    );
    this.server = undefined;
  }

  private next(): Scripted | undefined {
    const item = this.queue.shift() ?? this.repeating;
    if (item?.repeat) this.repeating = item;
    return item;
  }

  private respondJson(res: ServerResponse, status: number, payload: unknown): void {
    const data = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(data);
  }
}
