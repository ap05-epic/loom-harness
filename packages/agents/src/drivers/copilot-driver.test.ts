import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CopilotDriver,
  classifyCopilotError,
  detectCopilot,
  parseCopilotResponse,
  renderCopilotPrompt,
  runCopilotAgent,
  type CopilotExec,
} from './copilot-driver.js';

describe('renderCopilotPrompt', () => {
  test('flattens system + user messages into one prompt', () => {
    const p = renderCopilotPrompt([
      { role: 'system', content: 'Be precise.' },
      { role: 'user', content: 'Rebuild login.' },
    ]);
    expect(p).toContain('Be precise.');
    expect(p).toContain('Rebuild login.');
  });

  test('carries prior tool results forward', () => {
    const p = renderCopilotPrompt([
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: '1', name: 'write_file', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: '1', content: 'Wrote index.html' },
    ]);
    expect(p).toContain('Wrote index.html');
  });
});

describe('parseCopilotResponse', () => {
  test('extracts text and usage from a JSON result', () => {
    const r = parseCopilotResponse(
      JSON.stringify({ text: 'pong', usage: { input_tokens: 5, output_tokens: 1 } }),
    );
    expect(r.content).toBe('pong');
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 1 });
  });

  test('tolerates alternative field names', () => {
    const r = parseCopilotResponse(
      JSON.stringify({ response: 'hi', usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    );
    expect(r.content).toBe('hi');
    expect(r.usage.inputTokens).toBe(3);
    expect(r.usage.outputTokens).toBe(2);
  });

  test('handles JSONL by taking the final result line', () => {
    const out =
      '{"type":"progress"}\n{"type":"result","text":"done","usage":{"input_tokens":1,"output_tokens":1}}\n';
    expect(parseCopilotResponse(out).content).toBe('done');
  });

  test('falls back to raw text when output is not JSON', () => {
    expect(parseCopilotResponse('plain answer').content).toBe('plain answer');
  });

  test('extracts content + tokens from the real Copilot CLI event stream', () => {
    // The shape GitHub Copilot CLI 1.0.63 actually emits with --output-format json.
    const out = [
      JSON.stringify({ type: 'session.skills_loaded', data: { skills: [] } }),
      JSON.stringify({ type: 'assistant.reasoning_delta', data: { deltaContent: 'thinking' } }),
      JSON.stringify({
        type: 'assistant.message',
        data: { messageId: 'm1', model: 'claude-haiku-4.5', content: 'ok', outputTokens: 48 },
      }),
      JSON.stringify({ type: 'result', exitCode: 0, usage: { premiumRequests: 0.33 } }),
    ].join('\n');
    const r = parseCopilotResponse(out);
    expect(r.content).toBe('ok');
    expect(r.usage.outputTokens).toBe(48);
  });
});

describe('classifyCopilotError', () => {
  test('recognizes an unauthenticated / expired session', () => {
    expect(classifyCopilotError('Error: not logged in', 1).toLowerCase()).toContain('login');
    expect(classifyCopilotError('session expired', 1).toLowerCase()).toContain('login');
  });

  test('passes other errors through', () => {
    expect(classifyCopilotError('disk full', 2)).toContain('disk full');
  });
});

describe('CopilotDriver (injected exec — no key, no network)', () => {
  test('completes via the copilot CLI and accounts tokens', async () => {
    const calls: string[][] = [];
    const inputs: (string | undefined)[] = [];
    const exec: CopilotExec = (args, opts) => {
      calls.push(args);
      inputs.push(opts.input);
      return Promise.resolve({
        stdout: JSON.stringify({ text: 'pong', usage: { input_tokens: 4, output_tokens: 1 } }),
        stderr: '',
        exitCode: 0,
      });
    };
    const driver = new CopilotDriver({ exec, model: 'gpt-5.4' });
    const res = await driver.complete({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(res.content).toBe('pong');
    expect(res.usage.inputTokens).toBe(4);
    expect(calls[0]).toEqual(
      expect.arrayContaining(['--output-format', 'json', '--model', 'gpt-5.4']),
    );
    expect(inputs[0]).toContain('ping'); // prompt fed via stdin, not a -p arg
  });

  test('throws a re-auth hint on an expired session', async () => {
    const exec: CopilotExec = () =>
      Promise.resolve({ stdout: '', stderr: 'authentication required, please login', exitCode: 1 });
    const driver = new CopilotDriver({ exec });
    await expect(
      driver.complete({ model: 'gpt-5.4', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/login/i);
  });
});

describe('CopilotDriver (against a stubbed copilot binary)', () => {
  test('spawns the binary and parses its JSON — CI-safe without a live login', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'copilot-stub-'));
    const stub = join(dir, 'stub.js');
    writeFileSync(
      stub,
      `process.stdout.write(JSON.stringify({ text: 'stubbed-pong', usage: { input_tokens: 2, output_tokens: 1 } }));\n`,
    );
    chmodSync(stub, 0o755);
    // bin = [node, stub] makes the "binary" cross-platform.
    const driver = new CopilotDriver({ bin: [process.execPath, stub] });
    const res = await driver.complete({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(res.content).toBe('stubbed-pong');
    expect(res.usage.inputTokens).toBe(2);
  });
});

describe('runCopilotAgent (agentic build path, stubbed binary)', () => {
  test('runs copilot in a dir with --allow-all-tools and lets it write files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'copilot-agent-'));
    const stub = join(dir, 'agent-stub.js');
    // The stub stands in for an agentic copilot: it writes a file into its cwd
    // and reports usage as JSON — exactly the contract runCopilotAgent expects.
    writeFileSync(
      stub,
      `require('fs').writeFileSync('index.html', '<h1>built by copilot</h1>');\n` +
        `process.stdout.write(JSON.stringify({ text: 'done', usage: { input_tokens: 10, output_tokens: 5 } }));\n`,
    );
    const out = mkdtempSync(join(tmpdir(), 'copilot-out-'));
    const res = await runCopilotAgent({
      prompt: 'rebuild the login screen into this directory',
      cwd: out,
      bin: [process.execPath, stub],
    });
    expect(res.exitCode).toBe(0);
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('built by copilot');
  });

  test('passes --allow-all-tools, -C <cwd>, and --model in the argv', async () => {
    const seen: string[][] = [];
    const exec: CopilotExec = (args) => {
      seen.push(args);
      return Promise.resolve({ stdout: '{"text":"ok"}', stderr: '', exitCode: 0 });
    };
    await runCopilotAgent({ prompt: 'x', cwd: '/tmp/brepo', exec, model: 'gpt-5.4' });
    expect(seen[0]).toEqual(
      expect.arrayContaining(['--allow-all-tools', '-C', '/tmp/brepo', '--model', 'gpt-5.4']),
    );
  });
});

describe('detectCopilot', () => {
  test('reports installed + version from --version', async () => {
    const exec: CopilotExec = (args) =>
      Promise.resolve(
        args[0] === '--version'
          ? { stdout: 'copilot 1.0.62', stderr: '', exitCode: 0 }
          : { stdout: '{"text":"ok"}', stderr: '', exitCode: 0 },
      );
    const status = await detectCopilot({ exec, probeAuth: true });
    expect(status.installed).toBe(true);
    expect(status.version).toContain('1.0.62');
    expect(status.authenticated).toBe(true);
  });

  test('reports not-installed when the binary is missing', async () => {
    const exec: CopilotExec = () =>
      Promise.resolve({ stdout: '', stderr: 'not found', exitCode: 127 });
    const status = await detectCopilot({ exec });
    expect(status.installed).toBe(false);
    expect(status.authenticated).toBe(false);
  });
});
