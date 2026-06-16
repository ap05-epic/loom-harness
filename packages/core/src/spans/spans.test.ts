import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations } from '../db/db.js';
import { MIGRATIONS } from '../db/migrations.js';
import { SpanStore } from './spans.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

let dir: string;
let db: SqliteDatabase;
let store: SpanStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spans-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
  store = new SpanStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SpanStore', () => {
  test('records a completed LLM span with GenAI attributes and reads it back', () => {
    const span = store.record({
      traceId: 'run_1',
      name: 'llm.complete',
      kind: 'llm',
      status: 'ok',
      runId: 'run_1',
      wpId: 'wp_1',
      attemptId: 'att_1',
      durationMs: 1200,
      attributes: {
        'gen_ai.request.model': 'gpt-5.4',
        'gen_ai.usage.input_tokens': 100,
        'gen_ai.usage.output_tokens': 50,
      },
    });
    expect(span.id).toMatch(/^span_/);
    const got = store.get(span.id)!;
    expect(got.kind).toBe('llm');
    expect(got.status).toBe('ok');
    expect(got.durationMs).toBe(1200);
    expect(got.runId).toBe('run_1');
    expect((got.attributes as Record<string, unknown>)['gen_ai.request.model']).toBe('gpt-5.4');
    expect(got.endedAt).not.toBeNull();
  });

  test('startSpan opens a span and endSpan closes it (Live Now)', () => {
    const open = store.startSpan({
      traceId: 'run_1',
      name: 'attempt',
      kind: 'attempt',
      runId: 'run_1',
    });
    expect(store.get(open.id)!.endedAt).toBeNull();
    const closed = store.endSpan(open.id, {
      status: 'ok',
      durationMs: 500,
      attributes: { foo: 'bar' },
    });
    expect(closed).not.toBeNull();
    expect(closed!.endedAt).not.toBeNull();
    expect(closed!.durationMs).toBe(500);
    expect(closed!.status).toBe('ok');
    expect((closed!.attributes as Record<string, unknown>).foo).toBe('bar');
  });

  test('lists a run’s spans in start order, scoped to that run', () => {
    store.record({ traceId: 'run_1', name: 'a', kind: 'tool', runId: 'run_1' });
    store.record({ traceId: 'run_1', name: 'b', kind: 'llm', runId: 'run_1' });
    store.record({ traceId: 'run_2', name: 'c', kind: 'llm', runId: 'run_2' });
    expect(store.listForRun('run_1').map((s) => s.name)).toEqual(['a', 'b']);
  });

  test('aggregates token usage + duration across a run’s spans (the cost view)', () => {
    store.record({
      traceId: 'r',
      name: 'x',
      kind: 'llm',
      runId: 'r',
      durationMs: 100,
      attributes: { 'gen_ai.usage.input_tokens': 10, 'gen_ai.usage.output_tokens': 5 },
    });
    store.record({
      traceId: 'r',
      name: 'y',
      kind: 'llm',
      runId: 'r',
      durationMs: 200,
      attributes: { 'gen_ai.usage.input_tokens': 20, 'gen_ai.usage.output_tokens': 7 },
    });
    const agg = store.aggregate('r');
    expect(agg.spans).toBe(2);
    expect(agg.inputTokens).toBe(30);
    expect(agg.outputTokens).toBe(12);
    expect(agg.totalDurationMs).toBe(300);
  });
});
