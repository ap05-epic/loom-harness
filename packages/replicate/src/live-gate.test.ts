import { describe, expect, test } from 'vitest';
import type { NetworkRequest } from '@loom/browser';
import { liveDataGate } from './check.js';

const req = (url: string, resourceType = 'xhr'): NetworkRequest => ({
  method: 'GET',
  url,
  resourceType,
});

describe('liveDataGate (anti-hardcoding)', () => {
  test('passes when the replica fetched from the backend context', () => {
    const reqs = [
      req('http://127.0.0.1:5173/assets/app.js', 'script'),
      req('http://127.0.0.1:5173/BAA/ajaxComp.do?x=1'),
    ];
    const r = liveDataGate(reqs, '/BAA');
    expect(r.fetchedLive).toBe(true);
    expect(r.hits).toHaveLength(1);
  });

  test('fails when the replica only loaded its own assets (hardcoded data)', () => {
    const reqs = [
      req('http://127.0.0.1:5173/assets/app.js', 'script'),
      req('http://127.0.0.1:5173/index.html', 'document'),
    ];
    expect(liveDataGate(reqs, '/BAA').fetchedLive).toBe(false);
  });
});
