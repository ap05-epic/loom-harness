import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { findWorkspaceUp, loadWorkspace, WORKSPACE_FILE } from './workspace.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'workspace-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeWorkspace = (body: string): string => {
  const path = join(dir, WORKSPACE_FILE);
  writeFileSync(path, body);
  return path;
};

describe('loadWorkspace', () => {
  test('parses the manifest and records its directory', () => {
    const path = writeWorkspace(
      ['version: 1', 'active: baa', 'projects:', '  - { name: baa, dir: projects/baa }', ''].join(
        '\n',
      ),
    );
    const ws = loadWorkspace(path);
    expect(ws.version).toBe(1);
    expect(ws.active).toBe('baa');
    expect(ws.projects).toEqual([{ name: 'baa', dir: 'projects/baa' }]);
    expect(ws.dir).toBe(dir);
  });

  test('rejects a malformed manifest with a clear error', () => {
    const path = writeWorkspace('version: 1\nprojects: not-a-list\n');
    expect(() => loadWorkspace(path)).toThrow(/Invalid loom-workspace\.yaml/);
  });
});

describe('findWorkspaceUp', () => {
  test('walks up to find the manifest from a nested directory', () => {
    writeWorkspace('version: 1\nprojects: []\n');
    const nested = join(dir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    expect(findWorkspaceUp(nested)).toBe(join(dir, WORKSPACE_FILE));
  });

  test('returns null when there is no workspace above', () => {
    const lonely = mkdtempSync(join(tmpdir(), 'no-ws-'));
    try {
      expect(findWorkspaceUp(lonely)).toBeNull();
    } finally {
      rmSync(lonely, { recursive: true, force: true });
    }
  });
});
