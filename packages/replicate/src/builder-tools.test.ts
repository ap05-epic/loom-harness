import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createCrawlQueryTool, createListFilesTool, createReadFileTool } from './builder-tools.js';
import { openCrawlDb } from './crawl-db.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'btools-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createReadFileTool', () => {
  test('reads within root, refuses escape, errors on missing', async () => {
    writeFileSync(join(dir, 'a.jsp'), 'line1\nline2\nline3');
    const tool = createReadFileTool([dir]);
    expect(await tool.execute({ path: 'a.jsp' })).toContain('line2');
    expect(await tool.execute({ path: 'a.jsp', startLine: 2, endLine: 2 })).toBe('line2');
    expect(await tool.execute({ path: '../../etc/passwd' })).toMatch(/Refused/);
    expect(await tool.execute({ path: 'missing.jsp' })).toMatch(/Error/);
  });
});

describe('createListFilesTool', () => {
  test('lists files recursively, skips node_modules', async () => {
    writeFileSync(join(dir, 'x.jsp'), '');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'y.jsp'), '');
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'z.js'), '');
    const out = await createListFilesTool([dir]).execute({});
    expect(out).toContain('x.jsp');
    expect(out).toContain('sub/y.jsp');
    expect(out).not.toContain('node_modules');
  });
});

describe('createCrawlQueryTool', () => {
  test('answers per-screen interactions / endpoints / provenance', async () => {
    const dbPath = join(dir, 'crawl.db');
    const bodies = join(dir, 'bodies');
    const store = openCrawlDb(dbPath, { bodiesDir: bodies, secrets: [] });
    const s = store.upsertState({ key: 'dash', url: '/dash.do', stateTag: 'fa:abc' });
    store.recordInteraction({
      fromStateId: s,
      actionKind: 'click',
      label: 'Trades',
      actionTarget: '/trades.do',
      sig: 'x',
    });
    const ep = store.recordEndpoint({ stateId: s, method: 'GET', url: '/d.do', status: 200, body: '{"nnm":1}' });
    store.recordProvenance({ stateId: s, value: '993180706', endpointId: ep, label: 'NNM' });
    store.close();

    const tool = createCrawlQueryTool(dbPath, bodies);
    expect(await tool.execute({ what: 'states' })).toContain('dash');
    expect(await tool.execute({ what: 'interactions', screenKey: 'dash' })).toContain('Trades');
    expect(await tool.execute({ what: 'endpoints', screenKey: 'dash' })).toContain('/d.do');
    expect(await tool.execute({ what: 'provenance', screenKey: 'dash' })).toContain('993180706');
    expect(await tool.execute({ what: 'summary', screenKey: 'nope' })).toMatch(/No crawled state/);
  });
});
