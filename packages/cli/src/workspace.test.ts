import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveProjectContext } from './workspace.js';

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'ws-'));
  mkdirSync(join(ws, 'projects', 'baa'), { recursive: true });
  mkdirSync(join(ws, 'projects', 'claims'), { recursive: true });
  writeFileSync(
    join(ws, 'loom-workspace.yaml'),
    [
      'version: 1',
      'active: baa',
      'projects:',
      '  - { name: baa, dir: projects/baa }',
      '  - { name: claims, dir: projects/claims }',
      '',
    ].join('\n'),
  );
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe('resolveProjectContext', () => {
  test('an explicit --profile short-circuits the workspace (legacy behavior preserved)', () => {
    const r = resolveProjectContext({ flags: { profile: '/explicit' }, env: {}, cwd: ws });
    expect(r).toEqual({ profileDir: '/explicit' });
  });

  test('an explicit --data-dir short-circuits to cwd + that data dir', () => {
    const r = resolveProjectContext({ flags: { dataDir: '/data' }, env: {}, cwd: ws });
    expect(r).toEqual({ profileDir: ws, dataDir: '/data' });
  });

  test('with no flags, the workspace active project is resolved to its own dirs', () => {
    const r = resolveProjectContext({ flags: {}, env: {}, cwd: join(ws, 'projects') });
    expect(r).toEqual({
      profileDir: join(ws, 'projects', 'baa'),
      dataDir: join(ws, 'projects', 'baa', 'data'),
      project: 'baa',
    });
  });

  test('--project selects a different project in the workspace', () => {
    const r = resolveProjectContext({ flags: { project: 'claims' }, env: {}, cwd: ws });
    expect(r.project).toBe('claims');
    expect(r.dataDir).toBe(join(ws, 'projects', 'claims', 'data'));
  });

  test('with no workspace anywhere, falls back to cwd + LOOM_DATA_DIR', () => {
    const lonely = mkdtempSync(join(tmpdir(), 'lonely-'));
    try {
      const r = resolveProjectContext({ flags: {}, env: { LOOM_DATA_DIR: '/d' }, cwd: lonely });
      expect(r).toEqual({ profileDir: lonely, dataDir: '/d' });
    } finally {
      rmSync(lonely, { recursive: true, force: true });
    }
  });

  test('with nothing configured at all, defaults to the global ~/.loom home', () => {
    const lonely = mkdtempSync(join(tmpdir(), 'lonely-'));
    try {
      // No flags, no env, no workspace ⇒ the implicit home, so `loom` works with zero ceremony.
      const r = resolveProjectContext({ flags: {}, env: { LOOM_HOME: '/h' }, cwd: lonely });
      expect(r).toEqual({ profileDir: '/h', dataDir: '/h' });
    } finally {
      rmSync(lonely, { recursive: true, force: true });
    }
  });

  test('an unknown --project is a clear error', () => {
    expect(() => resolveProjectContext({ flags: { project: 'nope' }, env: {}, cwd: ws })).toThrow(
      /nope/,
    );
  });

  test('rejects a manifest that aliases two projects to the same data dir', () => {
    writeFileSync(
      join(ws, 'loom-workspace.yaml'),
      [
        'version: 1',
        'projects:',
        '  - { name: a, dir: projects/shared }',
        '  - { name: b, dir: projects/shared }',
        '',
      ].join('\n'),
    );
    expect(() => resolveProjectContext({ flags: { project: 'a' }, env: {}, cwd: ws })).toThrow(
      /same data dir|collide|duplicate/i,
    );
  });
});
