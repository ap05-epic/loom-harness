import type { Span } from './spans.js';

/** A minimal fetch shape — injectable so the exporter is testable without a network. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

type OtlpAttr = { key: string; value: Record<string, unknown> };

/** Map a JS value to an OTLP AnyValue. */
function otlpValue(v: unknown): Record<string, unknown> {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: JSON.stringify(v) };
}

function otlpAttrs(o: Record<string, unknown>): OtlpAttr[] {
  return Object.entries(o).map(([key, value]) => ({ key, value: otlpValue(value) }));
}

/** Deterministic, non-crypto hex of `bytes` length from a string id (stable id → OTLP hex id). */
function toHex(input: string, bytes: number): string {
  const out: number[] = [];
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes; i++) {
    for (let j = 0; j < input.length; j++) {
      h ^= input.charCodeAt(j) + i + 1;
      h = Math.imul(h, 0x01000193);
    }
    out.push((h >>> 0) & 0xff);
  }
  return out.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// OTLP SpanKind: CLIENT=3 for outbound LLM/tool calls, INTERNAL=1 otherwise.
const SPAN_KIND: Record<string, number> = { llm: 3, tool: 3, eval: 1, stage: 1, attempt: 1 };
// OTLP StatusCode: UNSET=0, OK=1, ERROR=2.
const STATUS_CODE: Record<string, number> = { unset: 0, ok: 1, error: 2 };

function unixNano(iso: string | null, fallback: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  const ms = Number.isNaN(t) ? Date.parse(fallback) : t;
  return Number.isNaN(ms) ? '0' : String(ms * 1_000_000);
}

/**
 * Shape Loom spans into an OTLP/HTTP traces payload following the OpenTelemetry GenAI semantic
 * conventions — so any OTLP collector the bank runs can ingest the harness's LLM/tool/eval spans.
 * Pure: our string ids fold to stable 16-/8-byte hex trace/span ids; attributes become OTLP
 * AnyValues; timestamps become unix-nanos.
 */
export function toOtlpTraces(spans: Span[], opts: { serviceName?: string } = {}): unknown {
  const otlpSpans = spans.map((s) => {
    const span: Record<string, unknown> = {
      traceId: toHex(s.traceId, 16),
      spanId: toHex(s.id, 8),
      name: s.name,
      kind: SPAN_KIND[s.kind] ?? 1,
      startTimeUnixNano: unixNano(s.startedAt, s.startedAt),
      endTimeUnixNano: unixNano(s.endedAt ?? s.startedAt, s.startedAt),
      attributes: otlpAttrs((s.attributes as Record<string, unknown>) ?? {}),
      status: { code: STATUS_CODE[s.status] ?? 0 },
    };
    if (s.parentId) span.parentSpanId = toHex(s.parentId, 8);
    return span;
  });
  return {
    resourceSpans: [
      {
        resource: { attributes: otlpAttrs({ 'service.name': opts.serviceName ?? 'loom-harness' }) },
        scopeSpans: [{ scope: { name: 'loom' }, spans: otlpSpans }],
      },
    ],
  };
}

/**
 * Export spans to an OTLP/HTTP collector (`<endpoint>/v1/traces`). Best-effort and injectable:
 * pass `fetchFn` in tests; with no spans it no-ops (status 0) and never touches the network. The
 * caller gates this on `OTEL_EXPORTER_OTLP_ENDPOINT` being set, so it's entirely optional.
 */
export async function exportSpansOtlp(opts: {
  endpoint: string;
  spans: Span[];
  serviceName?: string;
  fetchFn?: FetchLike;
}): Promise<{ ok: boolean; status: number }> {
  if (opts.spans.length === 0) return { ok: true, status: 0 };
  const url = `${opts.endpoint.replace(/\/+$/, '')}/v1/traces`;
  const doFetch = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) return { ok: false, status: 0 };
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toOtlpTraces(opts.spans, { serviceName: opts.serviceName })),
  });
  return { ok: res.ok, status: res.status };
}
