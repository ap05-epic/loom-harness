import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  ingestStrutsConfig,
  openCodeAtlas,
  parseStrutsConfig,
  type CodeAtlas,
} from '@loom/cartographer';
import { buildNavTree, navTreeToDot, printNavTree } from './graph.js';

// login --success--> list  and  list --back--> login  (a cycle, to prove we don't loop).
const XML = `<struts-config>
  <action-mappings>
    <action path="/login" type="com.x.LoginAction" input="/jsp/login.jsp">
      <forward name="success" path="/list.do" redirect="true"/>
    </action>
    <action path="/list" type="com.x.ListAction">
      <forward name="back" path="/login.do"/>
    </action>
  </action-mappings>
</struts-config>`;

let dir: string;
let atlas: CodeAtlas;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'navtree-'));
  atlas = openCodeAtlas(join(dir, 'codeatlas.db'));
  ingestStrutsConfig(atlas, parseStrutsConfig(XML));
});
afterEach(() => {
  atlas.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('buildNavTree', () => {
  test('resolves each screen to the screens it navigates to', () => {
    const tree = buildNavTree(atlas);
    expect(tree.screenCount).toBe(2);
    const login = tree.nodes.find((n) => n.key === 'login')!;
    const list = tree.nodes.find((n) => n.key === 'list')!;
    expect(login.to).toEqual(['list']); // /login --success--> /list.do → list
    expect(list.to).toEqual(['login']); // /list --back--> /login.do → login (cycle, no infinite loop)
  });

  test('exports a JSON-able structure + DOT, handling cycles without looping', () => {
    const tree = buildNavTree(atlas);
    expect(JSON.parse(JSON.stringify(tree)).nodes).toHaveLength(2);
    const dot = navTreeToDot(tree);
    expect(dot).toContain('"login" -> "list"');
    expect(dot).toContain('"list" -> "login"');
    expect(printNavTree(tree)).toContain('login  (/login)');
  });
});
