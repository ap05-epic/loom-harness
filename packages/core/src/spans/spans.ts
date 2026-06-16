import { newId } from '../ids.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

/** What an observability span measures (OpenTelemetry GenAI-shaped). */
export type SpanKind = 'llm' | 'tool' | 'eval' | 'stage' | 'attempt';
export type SpanStatus = 'ok' | 'error' | 'unset';

export type Span = {
  id: string;
  /** Groups spans of one run/operation — usually the run id. */
  traceId: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  runId: string | null;
  wpId: string | null;
  attemptId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  /** Free-form OTel attributes (e.g. `gen_ai.request.model`, `gen_ai.usage.input_tokens`). */
  attributes: unknown;
};

type SpanRow = {
  id: string;
  trace_id: string;
  parent_id: string | null;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  run_id: string | null;
  wp_id: string | null;
  attempt_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  attributes_json: string;
};

const toSpan = (r: SpanRow): Span => ({
  id: r.id,
  traceId: r.trace_id,
  parentId: r.parent_id,
  name: r.name,
  kind: r.kind,
  status: r.status,
  runId: r.run_id,
  wpId: r.wp_id,
  attemptId: r.attempt_id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationMs: r.duration_ms,
  attributes: JSON.parse(r.attributes_json),
});

export type SpanInput = {
  traceId: string;
  parentId?: string | null;
  name: string;
  kind: SpanKind;
  status?: SpanStatus;
  runId?: string;
  wpId?: string;
  attemptId?: string;
  durationMs?: number;
  attributes?: Record<string, unknown>;
};

/** Aggregate token + duration totals across a run's spans — powers the cost view. */
export type SpanAggregate = {
  spans: number;
  inputTokens: number;
  outputTokens: number;
  totalDurationMs: number;
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * The span log over harness.db — the OpenTelemetry-shaped observability spine that powers the
 * Live Now and cost views (and an optional OTLP export). LLM calls, tool calls, and eval layers
 * are recorded as spans with GenAI-convention attributes; everything is correlated to its run /
 * work package / attempt. Append-mostly, single-writer (the conductor), read-only for the UI.
 */
export class SpanStore {
  constructor(private readonly db: SqliteDatabase) {}

  /** Record a completed span (start≈end; timing carried in `durationMs`). */
  record(input: SpanInput): Span {
    const id = newId('span');
    this.db
      .prepare(
        `INSERT INTO spans (id, trace_id, parent_id, name, kind, status, run_id, wp_id, attempt_id,
           ended_at, duration_ms, attributes_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?)`,
      )
      .run(
        id,
        input.traceId,
        input.parentId ?? null,
        input.name,
        input.kind,
        input.status ?? 'ok',
        input.runId ?? null,
        input.wpId ?? null,
        input.attemptId ?? null,
        input.durationMs ?? null,
        JSON.stringify(input.attributes ?? {}),
      );
    return this.get(id)!;
  }

  /** Open a span (no end yet) — for Live Now tracking of an in-flight operation. */
  startSpan(input: Omit<SpanInput, 'durationMs'>): Span {
    const id = newId('span');
    this.db
      .prepare(
        `INSERT INTO spans (id, trace_id, parent_id, name, kind, status, run_id, wp_id, attempt_id,
           attributes_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.traceId,
        input.parentId ?? null,
        input.name,
        input.kind,
        input.status ?? 'unset',
        input.runId ?? null,
        input.wpId ?? null,
        input.attemptId ?? null,
        JSON.stringify(input.attributes ?? {}),
      );
    return this.get(id)!;
  }

  /** Close an open span: set its end time, duration, status, and merge in any attributes. */
  endSpan(
    id: string,
    opts: { status?: SpanStatus; durationMs?: number; attributes?: Record<string, unknown> } = {},
  ): Span | null {
    const current = this.get(id);
    if (!current) return null;
    const merged = {
      ...(current.attributes as Record<string, unknown>),
      ...(opts.attributes ?? {}),
    };
    this.db
      .prepare(
        `UPDATE spans SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), duration_ms = ?,
           status = ?, attributes_json = ? WHERE id = ?`,
      )
      .run(
        opts.durationMs ?? current.durationMs ?? null,
        opts.status ?? current.status,
        JSON.stringify(merged),
        id,
      );
    return this.get(id);
  }

  get(id: string): Span | null {
    const r = this.db.prepare('SELECT * FROM spans WHERE id = ?').get(id) as SpanRow | undefined;
    return r ? toSpan(r) : null;
  }

  /** All spans of a trace, in start order. */
  listForTrace(traceId: string): Span[] {
    const rows = this.db
      .prepare('SELECT * FROM spans WHERE trace_id = ? ORDER BY started_at ASC, rowid ASC')
      .all(traceId) as SpanRow[];
    return rows.map(toSpan);
  }

  /** All spans of a run, in start order. */
  listForRun(runId: string): Span[] {
    const rows = this.db
      .prepare('SELECT * FROM spans WHERE run_id = ? ORDER BY started_at ASC, rowid ASC')
      .all(runId) as SpanRow[];
    return rows.map(toSpan);
  }

  /** Sum GenAI token usage + duration across a run's spans (the cost view). */
  aggregate(runId: string): SpanAggregate {
    const spans = this.listForRun(runId);
    let inputTokens = 0;
    let outputTokens = 0;
    let totalDurationMs = 0;
    for (const s of spans) {
      const a = s.attributes as Record<string, unknown>;
      inputTokens += num(a['gen_ai.usage.input_tokens']);
      outputTokens += num(a['gen_ai.usage.output_tokens']);
      totalDurationMs += num(s.durationMs);
    }
    return { spans: spans.length, inputTokens, outputTokens, totalDurationMs };
  }
}
