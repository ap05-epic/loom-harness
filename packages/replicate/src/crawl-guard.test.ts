import { describe, expect, test } from 'vitest';
import type { DomSnapshot, NetworkRequest } from '@loom/browser';
import type { NavLink } from './nav.js';
import {
  buildWorkList,
  correlateProvenance,
  interactionSig,
  isDestructive,
  redactBody,
  redactSecret,
} from './crawl-guard.js';

describe('isDestructive', () => {
  test('flags logout/save/delete/submit/print/wire in label or target', () => {
    expect(isDestructive('Log Out', '')).toBe(true);
    expect(isDestructive('Save', '/x.do')).toBe(true);
    expect(isDestructive('Delete', '')).toBe(true);
    expect(isDestructive('Print', '')).toBe(true);
    expect(isDestructive('go', '/acct.do?cmd=delete')).toBe(true);
    expect(isDestructive('j_security_logout', '')).toBe(true);
  });
  test('allows safe navigation', () => {
    expect(isDestructive('View Trades', '/tradesAction.do')).toBe(false);
    expect(isDestructive('Account Details', '/acct.do')).toBe(false);
    expect(isDestructive('NNM', "javascript:getOverlay('x')")).toBe(false);
  });
});

describe('redactSecret / redactBody', () => {
  test('strips raw + url-encoded; multi-secret; no-op on empty', () => {
    expect(redactSecret('/x?fa=ZZ99&p=1', 'ZZ99')).toBe('/x?fa=<fa>&p=1');
    expect(redactSecret('/q?fa=AB%2010', 'AB 10')).toBe('/q?fa=<fa>');
    expect(redactSecret('/x', '')).toBe('/x');
    const body = redactBody('user=alice pass=s3cret fa=ZZ99', ['ZZ99', 's3cret']);
    expect(body).not.toContain('ZZ99');
    expect(body).not.toContain('s3cret');
  });
});

const cand = (ref: string, label: string, kind = 'a') => ({ ref, label, kind });
const nav = (label: string, target: string, kind: NavLink['kind'] = 'navigation'): NavLink => ({
  label,
  target,
  kind,
});

describe('buildWorkList', () => {
  test('merges a candidate with its navlink (one item, keeps ref + target)', () => {
    const work = buildWorkList({
      candidates: [cand('0:1', 'Trades')],
      navlinks: [nav('Trades', '/tradesAction.do')],
    });
    const trades = work.filter((w) => w.label === 'Trades');
    expect(trades).toHaveLength(1);
    expect(trades[0]!.ref).toBe('0:1');
    expect(trades[0]!.target).toBe('/tradesAction.do');
  });

  test('orders textboxes first, destructive last; js recorded', () => {
    const work = buildWorkList({
      candidates: [
        cand('0:1', 'Logout', 'button'),
        cand('0:2', 'FA', 'textbox'),
        cand('0:3', 'View'),
      ],
      navlinks: [nav('NNM', "javascript:getOverlay('x')", 'js-action')],
    });
    expect(work[0]!.isTextbox).toBe(true); // FA textbox first
    expect(work[work.length - 1]!.label).toBe('Logout'); // destructive last
    expect(work.find((w) => w.isJs)?.label).toBe('NNM'); // js recorded (record-only when !followJs)
  });

  test('drops anchors', () => {
    expect(buildWorkList({ candidates: [], navlinks: [nav('top', '#', 'anchor')] })).toHaveLength(
      0,
    );
  });
});

describe('interactionSig (finite + resumable)', () => {
  test('row-N labels collapse to one identity', () => {
    expect(interactionSig({ label: 'Account 12,345', isTextbox: false })).toBe(
      interactionSig({ label: 'Account 67,890', isTextbox: false }),
    );
  });
  test('different controls differ', () => {
    expect(interactionSig({ label: 'Trades', target: '/trades.do', isTextbox: false })).not.toBe(
      interactionSig({ label: 'Holdings', target: '/holdings.do', isTextbox: false }),
    );
  });
});

const leaf = (text: string): DomSnapshot => ({ tag: 'td', attrs: {}, text, children: [] });
const ep = (url: string, responseBody: string): NetworkRequest => ({
  method: 'GET',
  url,
  resourceType: 'xhr',
  responseBody,
});

describe('correlateProvenance', () => {
  test('maps a rendered number to the endpoint whose body contains it (comma-insensitive)', () => {
    const dom: DomSnapshot = { tag: 'body', attrs: {}, children: [leaf('$993,180,706')] };
    const got = correlateProvenance(dom, [
      ep('/main.css', 'body{}'), // wrong body
      ep('/dispatcher.do', '{"nnm": 993180706}'), // the source
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]!.endpointUrl).toBe('/dispatcher.do');
  });

  test('value in NO body skipped; bounded match (456 not inside 123456)', () => {
    const dom: DomSnapshot = { tag: 'body', attrs: {}, children: [leaf('456'), leaf('99999')] };
    const got = correlateProvenance(dom, [ep('/x.do', 'value=123456 zip=00000')]);
    expect(got).toHaveLength(0);
  });
});
