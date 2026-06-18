import { describe, expect, test } from 'vitest';
import { normalizeCookieDomain, normalizeCookies } from './cookies.js';

describe('normalizeCookieDomain', () => {
  test('strips a path accidentally included in the domain (the F12-copy case)', () => {
    // Copying a cookie by hand from DevTools can mash the host and path together into `domain`;
    // Playwright needs a bare host, so the path must come off.
    expect(
      normalizeCookieDomain('green-hedgehog.devpod.example.net/proxy/8080/BAA/loginAction.do'),
    ).toBe('green-hedgehog.devpod.example.net');
  });

  test('strips a scheme if the whole URL landed in the domain', () => {
    expect(normalizeCookieDomain('https://host.example.net/proxy/8080/BAA/')).toBe(
      'host.example.net',
    );
  });

  test('leaves a bare host unchanged', () => {
    expect(normalizeCookieDomain('host.example.net')).toBe('host.example.net');
  });

  test('preserves a leading dot (a domain-wide cookie)', () => {
    expect(normalizeCookieDomain('.example.net')).toBe('.example.net');
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeCookieDomain('  host.example.net  ')).toBe('host.example.net');
  });
});

describe('normalizeCookies', () => {
  test('normalizes each cookie domain, leaving the other fields intact', () => {
    const raw = [
      {
        name: 'JSESSIONID',
        value: 'abc',
        domain: 'host.example.net/proxy/8080/BAA/loginAction.do',
        path: '/',
      },
      { name: '_oauth2_proxy', value: 'xyz', domain: '.example.net', path: '/' },
    ];
    expect(normalizeCookies(raw)).toEqual([
      { name: 'JSESSIONID', value: 'abc', domain: 'host.example.net', path: '/' },
      { name: '_oauth2_proxy', value: 'xyz', domain: '.example.net', path: '/' },
    ]);
  });

  test('leaves a url-based cookie (no domain) untouched', () => {
    const raw = [{ name: 'x', value: '1', url: 'https://host.example.net/' }];
    expect(normalizeCookies(raw)).toEqual(raw);
  });
});
