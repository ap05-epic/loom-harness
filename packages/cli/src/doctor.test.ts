import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  dataDirCheck,
  gitTreeContaining,
  proxyStatus,
  runChecks,
  type DoctorCheck,
} from './doctor.js';

describe('runChecks', () => {
  test('built-in environment checks pass on a working dev machine', async () => {
    const results = await runChecks();
    const byName = new Map(results.map((r) => [r.name, r]));
    expect(byName.get('node-version')?.ok).toBe(true);
    expect(byName.get('sqlite')?.ok).toBe(true);
    expect(byName.get('git')?.ok).toBe(true);
  });

  test('failures carry a hint and do not abort the remaining checks', async () => {
    const failing: DoctorCheck = {
      name: 'always-fails',
      run: () => {
        throw new Error('boom');
      },
      hint: 'try turning it off and on again',
    };
    const ok: DoctorCheck = { name: 'always-ok', run: () => 'fine' };
    const results = await runChecks([failing, ok]);
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.detail).toMatch(/boom/);
    expect(results[0]?.hint).toMatch(/turning it off/);
    expect(results[1]?.ok).toBe(true);
  });
});

describe('data-dir-outside-git check', () => {
  test('gitTreeContaining detects inside vs outside a git repo', () => {
    expect(gitTreeContaining(process.cwd())).not.toBeNull(); // the test runs inside the repo
    expect(gitTreeContaining(mkdtempSync(join(tmpdir(), 'nogit-')))).toBeNull();
  });

  test('dataDirCheck fails when the data dir is inside a git clone', () => {
    expect(() => dataDirCheck(process.cwd())!.run()).toThrow(/git clone/i);
  });

  test('dataDirCheck passes for a dir outside git, and skips when unset', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'datadir-'));
    expect(String(dataDirCheck(tmp)!.run())).toContain('outside');
    expect(dataDirCheck(undefined)).toBeNull();
  });
});

describe('proxyStatus', () => {
  test('reports direct egress when no proxy is set', () => {
    expect(proxyStatus({})).toMatch(/no proxy/i);
  });

  test('flags the LLM host bypassing the proxy via NO_PROXY (and redacts creds)', () => {
    const s = proxyStatus({
      HTTPS_PROXY: 'http://user:secret@inet-proxy.example:8080',
      NO_PROXY: '.openai.azure.com,localhost',
      LLM_BASE_URL: 'https://cog.openai.azure.com/openai/v1',
    });
    expect(s).toContain('inet-proxy.example:8080');
    expect(s).not.toContain('secret'); // credentials never echoed
    expect(s).toMatch(/bypasses the proxy/);
  });

  test('warns when the LLM host is NOT covered by NO_PROXY', () => {
    const s = proxyStatus({
      HTTPS_PROXY: 'http://proxy.example:8080',
      NO_PROXY: 'localhost',
      LLM_BASE_URL: 'https://api.example.com/v1',
    });
    expect(s).toMatch(/NOT in NO_PROXY/);
  });
});
