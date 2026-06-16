import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mapProject } from './map.js';

function workspaceRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
    const p = dirname(d);
    if (p === d) throw new Error('workspace root not found');
    d = p;
  }
}

const STRUTS = join(
  workspaceRoot(),
  'fixtures',
  'legacy-webapp',
  'legacy-src',
  'WEB-INF',
  'struts-config.xml',
);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'map-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('mapProject against the real fixture struts-config.xml', () => {
  test('recovers all five screens with their JSPs and forms', () => {
    const atlas = mapProject({ strutsConfigPath: STRUTS, atlasPath: join(dir, 'codeatlas.db') });
    try {
      const screens = atlas.screens();
      expect(screens.map((s) => s.key).sort()).toEqual([
        'list',
        'login',
        'logout',
        'popup',
        'wizard',
      ]);

      const login = atlas.sliceForScreen('login')!;
      expect(login.action.meta).toMatchObject({
        type: 'com.example.legacy.web.action.LoginAction',
      });
      expect(login.jsps.map((j) => j.name)).toContain('/jsp/login.jsp');
      expect(login.formBean?.meta).toMatchObject({ type: 'com.example.legacy.web.form.LoginForm' });
    } finally {
      atlas.close();
    }
  });
});
