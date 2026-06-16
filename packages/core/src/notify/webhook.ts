import type { FetchLike } from '../spans/otlp.js';

/** A notification worth pinging a human about — async, out-of-band. */
export type WebhookEvent = {
  /** Machine kind, e.g. `shift_stopped`, `run_finished`, `gate_needed`. */
  kind: string;
  /** The human-readable line a chat app renders (Teams/Slack both honor `text`). */
  text: string;
  runId?: string;
  data?: unknown;
};

/**
 * POST a notification to a generic webhook (Teams/Slack-compatible: the chat app renders `text`).
 * Best-effort and injectable — pass `fetchFn` in tests. The caller gates this on a configured URL
 * (`LOOM_WEBHOOK_URL`), so it's entirely optional; failures are reported, never thrown.
 */
export async function notifyWebhook(opts: {
  url: string;
  event: WebhookEvent;
  fetchFn?: FetchLike;
}): Promise<{ ok: boolean; status: number }> {
  const doFetch = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) return { ok: false, status: 0 };
  const res = await doFetch(opts.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: opts.event.text,
      kind: opts.event.kind,
      runId: opts.event.runId,
      data: opts.event.data,
    }),
  });
  return { ok: res.ok, status: res.status };
}
