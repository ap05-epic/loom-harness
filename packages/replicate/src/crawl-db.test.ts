import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openCrawlDb, type CrawlStore } from './crawl-db.js';

const FA = 'ZZ99'; // a clearly-fake test FA
let dir: string;
let store: CrawlStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crawldb-'));
  store = openCrawlDb(join(dir, 'crawl.db'), { bodiesDir: join(dir, 'bodies'), secrets: [FA] });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('CrawlStore', () => {
  test('upsertState is insert-or-get by (key, state_tag)', () => {
    const a = store.upsertState({ key: 'k1', url: '/x', stateTag: 'no-fa' });
    expect(store.upsertState({ key: 'k1', url: '/x', stateTag: 'no-fa' })).toBe(a); // same row
    expect(store.upsertState({ key: 'k1', url: '/x', stateTag: 'fa:abc' })).not.toBe(a); // new state
  });

  test('recordInteraction idempotent by (from, sig); patch sets to-state', () => {
    const s1 = store.upsertState({ key: 'a', url: '/a', stateTag: 'no-fa' });
    const id = store.recordInteraction({
      fromStateId: s1,
      actionKind: 'click',
      label: 'Trades',
      sig: 'sigT',
    });
    expect(
      store.recordInteraction({
        fromStateId: s1,
        actionKind: 'click',
        label: 'Trades',
        sig: 'sigT',
      }),
    ).toBe(id);
    const s2 = store.upsertState({ key: 'b', url: '/b', stateTag: 'no-fa' });
    store.patchInteractionTo(id, s2, true);
    expect(store.interactionsFor(s1)[0]!.to_state_id).toBe(s2);
  });

  test('endpoint body written + provenance round-trips', () => {
    const s = store.upsertState({ key: 'a', url: '/a', stateTag: 'no-fa' });
    const ep = store.recordEndpoint({
      stateId: s,
      method: 'GET',
      url: '/dispatcher.do',
      resourceType: 'xhr',
      status: 200,
      body: '{"nnm":993180706}',
    });
    store.recordProvenance({ stateId: s, value: '993180706', endpointId: ep, label: 'NNM' });
    const prov = store.provenanceFor(s);
    expect(prov).toHaveLength(1);
    expect(prov[0]!.endpoint_url).toBe('/dispatcher.do');
    const bodyPath = store.endpointsFor(s)[0]!.body_path!;
    expect(readFileSync(bodyPath, 'utf8')).toContain('993180706');
  });

  test('RESUME: seenStateKeys + triedSigs persist across reopen', () => {
    const s = store.upsertState({ key: 'a', url: '/a', stateTag: 'no-fa' });
    store.recordInteraction({ fromStateId: s, actionKind: 'click', sig: 'sigX', label: 'x' });
    store.close();
    store = openCrawlDb(join(dir, 'crawl.db'), { bodiesDir: join(dir, 'bodies'), secrets: [FA] });
    expect(store.seenStateKeys().has('a::no-fa')).toBe(true);
    expect(store.triedSigs(store.stateIdFor('a', 'no-fa')!).has('sigX')).toBe(true);
  });

  test('SECURITY: the raw FA never lands in the DB or a body file', () => {
    const s = store.upsertState({
      key: 'a',
      url: `/login.do?fa=${FA}`,
      stateTag: 'fa:hash',
      title: `Acct ${FA}`,
    });
    const ep = store.recordEndpoint({
      stateId: s,
      method: 'GET',
      url: `/d.do?fa=${FA}`,
      body: `data fa=${FA} nnm=1`,
    });
    store.recordInteraction({
      fromStateId: s,
      actionKind: 'click',
      actionTarget: `/x.do?fa=${FA}`,
      sig: 's',
      label: `go ${FA}`,
    });
    store.recordProvenance({ stateId: s, value: `acct-${FA}`, endpointId: ep, label: `lbl ${FA}` });
    expect(JSON.stringify(store.graph())).not.toContain(FA);
    expect(JSON.stringify(store.endpointsFor(s))).not.toContain(FA);
    expect(JSON.stringify(store.provenanceFor(s))).not.toContain(FA);
    expect(readFileSync(store.endpointsFor(s)[0]!.body_path!, 'utf8')).not.toContain(FA);
  });
});
