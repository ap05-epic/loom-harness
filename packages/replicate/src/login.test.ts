import { describe, expect, test } from 'vitest';
import type { NetworkRequest } from '@loom/browser';
import { dataEndpoints, redactFa } from './login.js';

describe('redactFa', () => {
  test('strips the raw and URL-encoded FA from a URL', () => {
    expect(redactFa('/BAA/x.do?faNum=ZZ99&y=1', 'ZZ99')).toBe('/BAA/x.do?faNum=<fa>&y=1');
    expect(redactFa('/q?fa=AB%2010', 'AB 10')).toBe('/q?fa=<fa>'); // URL-encoded form
    expect(redactFa('/x', '')).toBe('/x'); // empty fa → no-op
  });
});

describe('dataEndpoints', () => {
  const reqs: NetworkRequest[] = [
    { method: 'GET', url: '/BAA/dispatcher.do?faNum=ZZ99', resourceType: 'document', status: 200 },
    { method: 'GET', url: '/BAA/css/main.css', resourceType: 'stylesheet', status: 200 },
    { method: 'POST', url: '/BAA/ajaxComp.do', resourceType: 'xhr', status: 200 },
    { method: 'POST', url: '/BAA/ajaxComp.do', resourceType: 'xhr', status: 200 }, // dup
  ];
  test('keeps data requests, drops assets, redacts the FA, dedupes', () => {
    const out = dataEndpoints(reqs, 'ZZ99');
    expect(out).toHaveLength(2); // document + xhr (css dropped, dup removed)
    expect(out.map((r) => r.url)).toContain('/BAA/dispatcher.do?faNum=<fa>'); // redacted
    expect(out.find((r) => r.resourceType === 'stylesheet')).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('ZZ99'); // security: the raw FA never survives
  });
});
