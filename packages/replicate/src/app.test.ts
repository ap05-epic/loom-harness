import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  ingestStrutsConfig,
  openCodeAtlas,
  parseStrutsConfig,
  type CodeAtlas,
} from '@loom/cartographer';
import { collectAppScreens, generateAppShell, sanitizeKey, screenComponentPath } from './app.js';

describe('sanitizeKey / screenComponentPath', () => {
  test('makes a safe file id', () => {
    expect(sanitizeKey('loginAction.do')).toBe('loginAction_do');
    expect(screenComponentPath('loginAction.do').replace(/\\/g, '/')).toBe(
      'src/screens/loginAction_do.tsx',
    );
  });
});

describe('generateAppShell', () => {
  test('wires screens into a router that intercepts in-app links', () => {
    const shell = generateAppShell([
      { key: 'loginAction', route: 'loginaction', importPath: './screens/loginAction', componentName: 'LoginAction' },
      { key: 'creditLineAction', route: 'creditlineaction', importPath: './screens/creditLineAction', componentName: 'CreditLineAction' },
    ]);
    expect(shell).toContain("import LoginAction from './screens/loginAction'");
    expect(shell).toContain('"loginaction": LoginAction');
    expect(shell).toContain('"creditlineaction": CreditLineAction');
    expect(shell).toContain('routeKey'); // the in-app link interceptor
    expect(shell).toContain('export default function App');
  });
  test('empty → a placeholder app, no screen imports', () => {
    const shell = generateAppShell([]);
    expect(shell).toContain('export default function App');
    expect(shell).not.toContain('./screens/');
  });
});

const XML = `<struts-config><action-mappings>
  <action path="/loginAction" type="x"><forward name="s" path="/jsp/x.jsp"/></action>
  <action path="/creditLineAction" type="x"><forward name="s" path="/jsp/y.jsp"/></action>
</action-mappings></struts-config>`;

describe('collectAppScreens', () => {
  let dir: string;
  let atlas: CodeAtlas;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'app-'));
    atlas = openCodeAtlas(join(dir, 'atlas.db'));
    ingestStrutsConfig(atlas, parseStrutsConfig(XML));
    mkdirSync(join(dir, 'src', 'screens'), { recursive: true });
    writeFileSync(join(dir, 'src', 'screens', 'loginAction.tsx'), 'export default () => null;');
  });
  afterEach(() => {
    atlas.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('includes only screens that have a component file', () => {
    const screens = collectAppScreens(dir, atlas);
    expect(screens.map((s) => s.key)).toEqual(['loginAction']); // creditLineAction has no file → excluded
    expect(screens[0]!.route).toBe('loginaction');
  });
});
