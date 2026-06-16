import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations, MIGRATIONS, MemoryStore } from '@loom/core';
import type { SqliteDatabase } from '@loom/core';
import type { LlmGateway } from '../types.js';
import { buildRunSummaryPrompt, summarizeRun } from './run-summary.js';

const stubGateway = (content: string | null): LlmGateway => ({
  complete: async () => ({
    content,
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: 'stop',
  }),
});

let dir: string;
let db: SqliteDatabase;
let memory: MemoryStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'run-summary-'));
  db = openDb(join(dir, 'loom.db'));
  runMigrations(db, MIGRATIONS);
  memory = new MemoryStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('summarizeRun', () => {
  test('drafts a run reflection and persists it as reflection memory', async () => {
    const gateway = stubGateway(
      '3 screens shipped, 1 blocked on visual diff. Recurring: dates render dd.MM.yyyy — candidate skill.',
    );
    const reflection = await summarizeRun(gateway, memory, {
      project: 'demo',
      runId: 'r_42',
      notes: 'shipped: login, list, detail; blocked: pricing-grid (visual diff 3.4%)',
      model: 'gpt-x',
    });

    expect(reflection).not.toBeNull();
    expect(reflection!.kind).toBe('reflection');
    expect(reflection!.body).toContain('visual diff');
    const stored = memory.list('demo', { kind: 'reflection' });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.meta).toMatchObject({ runId: 'r_42' });
  });

  test('grounds the prompt on the run id + notes and asks for a concise recap', () => {
    const messages = buildRunSummaryPrompt({
      runId: 'r_42',
      notes: 'shipped 3, blocked 1 on visual diff',
    });
    const all = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    expect(all).toContain('r_42');
    expect(all).toContain('visual diff');
  });

  test('an empty model reply writes nothing (no hollow reflection)', async () => {
    const reflection = await summarizeRun(stubGateway('   '), memory, {
      project: 'demo',
      runId: 'r_43',
      notes: 'n',
      model: 'gpt-x',
    });
    expect(reflection).toBeNull();
    expect(memory.list('demo', { kind: 'reflection' })).toEqual([]);
  });
});
