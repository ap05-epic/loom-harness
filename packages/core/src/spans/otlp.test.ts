import { describe, expect, test } from 'vitest';
import { exportSpansOtlp, toOtlpTraces } from './otlp.js';
import type { Span } from './spans.js';

const span: Span = {
  id: 'span_1',
  traceId: 'run_1',
  parentId: null,
  name: 'build.attempt',
  kind: 'llm',
  status: 'ok',
  runId: 'run_1',
  wpId: 'wp_1',
  attemptId: 'att_1',
  startedAt: '2026-06-16T12:00:00.000Z',
  endedAt: '2026-06-16T12:00:01.000Z',
  durationMs: 1000,
  attributes: { 'gen_ai.request.model': 'gpt-5.4', 'gen_ai.usage.input_tokens': 100 },
};

describe('toOtlpTraces', () => {
  test('shapes spans into OTLP resourceSpans with GenAI attributes', () => {
    const otlp = toOtlpTraces([span], { serviceName: 'loom-harness' }) as {
      resourceSpans: Array<{
        resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
        scopeSpans: Array<{ spans: Array<Record<string, unknown>> }>;
      }>;
    };
    const rs = otlp.resourceSpans[0]!;
    expect(rs.resource.attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'loom-harness' },
    });
    const s = rs.scopeSpans[0]!.spans[0]! as {
      name: string;
      kind: number;
      traceId: string;
      spanId: string;
      status: { code: number };
      startTimeUnixNano: string;
      endTimeUnixNano: string;
      attributes: Array<{ key: string; value: Record<string, unknown> }>;
    };
    expect(s.name).toBe('build.attempt');
    expect(s.kind).toBe(3); // CLIENT for an llm span
    expect(s.traceId).toMatch(/^[0-9a-f]{32}$/); // 16-byte hex
    expect(s.spanId).toMatch(/^[0-9a-f]{16}$/); // 8-byte hex
    expect(s.status.code).toBe(1); // OK
    expect(s.attributes).toContainEqual({
      key: 'gen_ai.request.model',
      value: { stringValue: 'gpt-5.4' },
    });
    expect(s.attributes).toContainEqual({
      key: 'gen_ai.usage.input_tokens',
      value: { intValue: '100' },
    });
    // 1 second elapsed = 1e9 nanoseconds
    expect(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)).toBe(1_000_000_000n);
  });
});

describe('exportSpansOtlp', () => {
  test('POSTs OTLP JSON to <endpoint>/v1/traces', async () => {
    let captured: { url: string; body: string } | null = null;
    const fakeFetch = async (url: string, init: { body: string }) => {
      captured = { url, body: init.body };
      return { ok: true, status: 200 };
    };
    const res = await exportSpansOtlp({
      endpoint: 'http://collector:4318/',
      spans: [span],
      fetchFn: fakeFetch,
    });
    expect(res).toEqual({ ok: true, status: 200 });
    expect(captured!.url).toBe('http://collector:4318/v1/traces');
    expect(JSON.parse(captured!.body).resourceSpans).toBeDefined();
  });

  test('no-ops cleanly when there are no spans', async () => {
    let called = false;
    const res = await exportSpansOtlp({
      endpoint: 'http://c:4318',
      spans: [],
      fetchFn: async () => {
        called = true;
        return { ok: true, status: 200 };
      },
    });
    expect(called).toBe(false);
    expect(res).toEqual({ ok: true, status: 0 });
  });
});
