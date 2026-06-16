import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations } from '../db/db.js';
import { MIGRATIONS } from '../db/migrations.js';
import { MemoryStore } from './memory.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

let dir: string;
let db: SqliteDatabase;
let store: MemoryStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'memory-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
  store = new MemoryStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('MemoryStore', () => {
  test('remembers a project fact and reads it back', () => {
    const m = store.remember({
      project: 'demo',
      kind: 'project_fact',
      title: 'Date format',
      body: 'All dates render dd.MM.yyyy across the app',
      meta: { source: 'reflector' },
    });
    expect(m.id).toMatch(/^mem_/);
    const got = store.get(m.id)!;
    expect(got.project).toBe('demo');
    expect(got.kind).toBe('project_fact');
    expect(got.body).toContain('dd.MM.yyyy');
    expect(got.meta).toEqual({ source: 'reflector' });
  });

  test('lists by kind and by scope (a WP worklog)', () => {
    store.remember({ project: 'demo', kind: 'project_fact', title: 'A', body: 'alpha' });
    store.remember({
      project: 'demo',
      kind: 'worklog',
      scopeId: 'wp_1',
      title: 'Attempt 1',
      body: 'tried inline styles; failed the style gate',
    });
    store.remember({
      project: 'demo',
      kind: 'worklog',
      scopeId: 'wp_2',
      title: 'Other WP',
      body: 'unrelated',
    });

    expect(store.list('demo', { kind: 'project_fact' }).map((m) => m.title)).toEqual(['A']);
    const worklog = store.list('demo', { kind: 'worklog', scopeId: 'wp_1' });
    expect(worklog).toHaveLength(1);
    expect(worklog[0]!.body).toContain('style gate');
  });

  test('recall ranks by term overlap, honors the limit, and excludes zero-match memories', () => {
    store.remember({
      project: 'demo',
      kind: 'project_fact',
      title: 'Date format',
      body: 'All dates render dd.MM.yyyy',
    });
    store.remember({
      project: 'demo',
      kind: 'worklog',
      scopeId: 'wp_1',
      title: 'Login attempt',
      body: 'the date field needs a mask',
    });
    store.remember({
      project: 'demo',
      kind: 'project_fact',
      title: 'Nav layout',
      body: 'header is the main layout',
    });

    const hits = store.recall('demo', { terms: ['date', 'field'], limit: 5 });
    // worklog matches both 'date' + 'field' (score 2) → ranks above the date-only fact (score 1).
    expect(hits.map((m) => m.title)).toEqual(['Login attempt', 'Date format']);
    // 'Nav layout' matched no term → excluded.
    expect(hits.some((m) => m.title === 'Nav layout')).toBe(false);

    expect(
      store.recall('demo', { terms: ['date', 'field'], limit: 1 }).map((m) => m.title),
    ).toEqual(['Login attempt']);
  });

  test('memory is scoped per project — recall never leaks across projects', () => {
    store.remember({
      project: 'other',
      kind: 'project_fact',
      title: 'Leaky',
      body: 'date date date field field',
    });
    store.remember({
      project: 'demo',
      kind: 'project_fact',
      title: 'Mine',
      body: 'date field',
    });
    const hits = store.recall('demo', { terms: ['date', 'field'] });
    expect(hits.map((m) => m.title)).toEqual(['Mine']);
  });

  test('consolidate dedups exact-duplicate project facts, keeping the newest copy', () => {
    // The Reflector re-discovers the same convention across shifts (same body, varied title/case).
    store.remember({
      project: 'demo',
      kind: 'project_fact',
      title: 'Dates',
      body: 'Dates render dd.MM.yyyy',
    });
    store.remember({
      project: 'demo',
      kind: 'project_fact',
      title: 'Dates (again)',
      body: 'dates render DD.MM.yyyy  ', // same normalized body
    });
    store.remember({
      project: 'demo',
      kind: 'project_fact',
      title: 'Nav',
      body: 'header is the main layout',
    });

    const res = store.consolidate('demo');

    expect(res.deduped).toBe(1);
    expect(res.kept).toBe(2);
    const facts = store.list('demo', { kind: 'project_fact' });
    expect(facts).toHaveLength(2);
    const bodies = facts.map((f) => f.body.toLowerCase().replace(/\s+/g, ' ').trim());
    expect(bodies).toContain('header is the main layout'); // the distinct fact survives
    expect(bodies.filter((b) => b.includes('dd.mm.yyyy'))).toHaveLength(1); // one date fact remains
  });

  test('consolidate trims to maxFacts, keeping the most recent', () => {
    for (let i = 0; i < 5; i++) {
      store.remember({
        project: 'demo',
        kind: 'project_fact',
        title: `F${i}`,
        body: `fact number ${i}`,
      });
    }
    const res = store.consolidate('demo', { maxFacts: 3 });
    expect(res.trimmed).toBe(2);
    expect(res.kept).toBe(3);
    expect(store.list('demo', { kind: 'project_fact' }).map((f) => f.title)).toEqual([
      'F4',
      'F3',
      'F2',
    ]);
  });

  test('consolidate touches only the project’s facts — not worklog/reflection or other projects', () => {
    store.remember({ project: 'demo', kind: 'project_fact', title: 'A', body: 'same fact' });
    store.remember({ project: 'demo', kind: 'project_fact', title: 'B', body: 'same fact' }); // dup
    store.remember({
      project: 'demo',
      kind: 'worklog',
      scopeId: 'wp',
      title: 'W',
      body: 'same fact',
    });
    store.remember({ project: 'other', kind: 'project_fact', title: 'O', body: 'same fact' });

    const res = store.consolidate('demo');

    expect(res.deduped).toBe(1);
    expect(store.list('demo', { kind: 'worklog' })).toHaveLength(1); // worklog untouched
    expect(store.list('other', { kind: 'project_fact' })).toHaveLength(1); // other project untouched
  });

  test('remember upserts by id, and forget removes', () => {
    const m = store.remember({ project: 'demo', kind: 'project_fact', title: 'T', body: 'v1' });
    const updated = store.remember({
      id: m.id,
      project: 'demo',
      kind: 'project_fact',
      title: 'T',
      body: 'v2',
    });
    expect(updated.id).toBe(m.id);
    expect(store.get(m.id)!.body).toBe('v2');
    expect(store.list('demo')).toHaveLength(1);

    store.forget(m.id);
    expect(store.get(m.id)).toBeNull();
  });
});
