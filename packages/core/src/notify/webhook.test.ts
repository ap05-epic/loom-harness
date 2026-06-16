import { describe, expect, test } from 'vitest';
import { notifyWebhook } from './webhook.js';

describe('notifyWebhook', () => {
  test('POSTs a Teams/Slack-compatible JSON payload', async () => {
    let captured: { url: string; body: string } | null = null;
    const fakeFetch = async (url: string, init: { body: string }) => {
      captured = { url, body: init.body };
      return { ok: true, status: 200 };
    };
    const res = await notifyWebhook({
      url: 'https://hooks.example/loom',
      event: { kind: 'shift_stopped', text: 'Shift stopped: stop_the_line', runId: 'run_1' },
      fetchFn: fakeFetch,
    });
    expect(res).toEqual({ ok: true, status: 200 });
    expect(captured!.url).toBe('https://hooks.example/loom');
    const payload = JSON.parse(captured!.body);
    expect(payload.text).toContain('Shift stopped'); // `text` is what Teams/Slack render
    expect(payload.kind).toBe('shift_stopped');
    expect(payload.runId).toBe('run_1');
  });

  test('reports failure status without throwing', async () => {
    const res = await notifyWebhook({
      url: 'https://hooks.example/loom',
      event: { kind: 'x', text: 'y' },
      fetchFn: async () => ({ ok: false, status: 500 }),
    });
    expect(res).toEqual({ ok: false, status: 500 });
  });
});
