import { resolve } from 'node:path';
import type { Profile } from '@loom/core';
import { describe, expect, test } from 'vitest';
import { exploreOptionsFrom, formatDiagnosis } from './explore.js';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    project: 'fixture',
    dir: resolve('/profiles/fixture'),
    dataDir: resolve('/data/fixture'),
    env: { LLM_BASE_URL: 'http://x/openai/v1', LLM_API_KEY: 'k' },
    llm: {
      driver: 'openai',
      model: 'gpt-5.4',
      baseUrlEnv: 'LLM_BASE_URL',
      apiKeyEnv: 'LLM_API_KEY',
    },
    source: { strutsConfig: './legacy/struts-config.xml' },
    app: { baseUrl: 'http://127.0.0.1:8090/BAA/' },
    ...overrides,
  } as Profile;
}

const authCrawl = {
  startPath: '.',
  auth: {
    loginPath: 'jsp/login.jsp',
    usernameSelector: 'input[name=user]',
    passwordSelector: 'input[name=password]',
    submitSelector: 'input[type=submit]',
    usernameEnv: 'BAA_USER',
    passwordEnv: 'BAA_PASS',
  },
};

const creds = { LLM_BASE_URL: 'http://x/openai/v1', LLM_API_KEY: 'k' };

describe('exploreOptionsFrom', () => {
  test('builds secrets (user/pass/fa) from env, a chooser, and the start URL', () => {
    const p = profile({
      crawl: authCrawl,
      env: { ...creds, BAA_USER: 'alice', BAA_PASS: 'pw', fa_numbers: 'AB10' },
    });
    const opts = exploreOptionsFrom(p, 3);
    expect(opts.secrets).toEqual({ user: 'alice', pass: 'pw', fa: 'AB10' });
    expect(typeof opts.chooser).toBe('function'); // an LLM chooser was wired
    expect(opts.startUrl).toBe('http://127.0.0.1:8090/BAA/'); // startPath '.' keeps the /BAA/ context
    expect(opts.maxStates).toBe(3); // the --max-states override wins
  });

  test('honours a custom crawl.faEnv', () => {
    const p = profile({
      crawl: { ...authCrawl, faEnv: 'FA_CODE' },
      env: { ...creds, BAA_USER: 'a', BAA_PASS: 'b', FA_CODE: 'ZZ99' },
    });
    expect(exploreOptionsFrom(p).secrets).toEqual({ user: 'a', pass: 'b', fa: 'ZZ99' });
  });

  test('passes app.storageStatePath through (the SSO fallback)', () => {
    const p = profile({ app: { baseUrl: 'http://app/', storageStatePath: '/data/auth.json' } });
    expect(exploreOptionsFrom(p).storageStatePath).toBe('/data/auth.json');
  });

  test('errors (CONFIG) when app.baseUrl is missing', () => {
    expect(() => exploreOptionsFrom(profile({ app: undefined }))).toThrow(/baseUrl/i);
  });

  test('errors (CONFIG) when auth is set but the credential env vars are unset', () => {
    const p = profile({ crawl: authCrawl, env: { ...creds } });
    expect(() => exploreOptionsFrom(p)).toThrow(/credentials not set|BAA_USER/i);
  });

  test('works without auth — no login, the model just explores', () => {
    const opts = exploreOptionsFrom(profile({ app: { baseUrl: 'http://app/' } }));
    expect(opts.secrets).toEqual({});
  });
});

describe('formatDiagnosis', () => {
  test('renders the url, title, frame count, per-frame control counts and text snippet', () => {
    const text = formatDiagnosis({
      url: 'http://app/BAA/loginAction.do',
      title: 'BAA',
      frames: [
        {
          index: 0,
          name: '',
          url: 'http://app/BAA/loginAction.do',
          candidates: 0,
          text: 'Loading the workspace',
        },
        { index: 1, name: 'menu', url: 'http://app/BAA/qpmenu.do', candidates: 0, text: '' },
      ],
    });
    expect(text).toContain('loginAction.do'); // the page URL
    expect(text).toContain('BAA'); // the title
    expect(text).toContain('2 frame'); // frame count
    expect(text).toContain('cands=0'); // per-frame control count
    expect(text).toContain('menu'); // the named child frame
    expect(text).toContain('Loading the workspace'); // a text snippet to read over OCR
  });
});
