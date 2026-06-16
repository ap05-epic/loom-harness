import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openCodeAtlas, type CodeAtlas } from './codeatlas.js';
import { ingestStrutsConfig } from './map.js';
import { parseStrutsConfig } from './struts-parser.js';

const XML = `<struts-config>
  <form-beans><form-bean name="loginForm" type="com.x.LoginForm"/></form-beans>
  <action-mappings>
    <action path="/login" type="com.x.LoginAction" name="loginForm" input="/jsp/login.jsp">
      <forward name="success" path="/list.do" redirect="true"/>
      <forward name="failure" path="/jsp/login.jsp"/>
    </action>
    <action path="/list" type="com.x.DealListAction">
      <forward name="success" path="/jsp/list.jsp"/>
    </action>
  </action-mappings>
</struts-config>`;

let dir: string;
let atlas: CodeAtlas;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codeatlas-'));
  atlas = openCodeAtlas(join(dir, 'codeatlas.db'));
  ingestStrutsConfig(atlas, parseStrutsConfig(XML));
});
afterEach(() => {
  atlas.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('CodeAtlas', () => {
  test('records action, jsp, and form-bean nodes', () => {
    expect(
      atlas
        .nodesByKind('action')
        .map((n) => n.name)
        .sort(),
    ).toEqual(['/list', '/login']);
    expect(
      atlas
        .nodesByKind('jsp')
        .map((n) => n.name)
        .sort(),
    ).toEqual(['/jsp/list.jsp', '/jsp/login.jsp']);
    expect(atlas.nodesByKind('form_bean').map((n) => n.name)).toEqual(['loginForm']);
  });

  test('derives one screen per action with its view JSP and form', () => {
    const screens = atlas.screens();
    const login = screens.find((s) => s.key === 'login')!;
    expect(login.actionPath).toBe('/login');
    expect(login.viewJsps).toContain('/jsp/login.jsp');
    expect(login.formBean).toBe('com.x.LoginForm');
  });

  test('sliceForScreen returns the action, form, and JSPs for one screen', () => {
    const slice = atlas.sliceForScreen('login');
    expect(slice).not.toBeNull();
    expect(slice!.action.name).toBe('/login');
    expect(slice!.jsps.map((j) => j.name)).toContain('/jsp/login.jsp');
    expect(slice!.formBean?.meta).toMatchObject({ type: 'com.x.LoginForm' });
  });

  test('sliceForScreen returns null for an unknown screen', () => {
    expect(atlas.sliceForScreen('nope')).toBeNull();
  });

  test('re-opening the same file preserves the data', () => {
    const path = atlas.path;
    atlas.close();
    const reopened = openCodeAtlas(path);
    expect(reopened.screens().length).toBe(2);
    reopened.close();
  });
});

describe('CodeAtlas — graph primitives', () => {
  test('ensureNode is find-or-create (no duplicates)', () => {
    const a = atlas.ensureNode('taglib', 'html');
    const b = atlas.ensureNode('taglib', 'html');
    expect(a).toBe(b);
    expect(atlas.nodesByKind('taglib')).toHaveLength(1);
  });

  test('setNodeMeta replaces a node’s metadata', () => {
    const id = atlas.ensureNode('jsp', '/jsp/x.jsp');
    atlas.setNodeMeta(id, { forms: [{ action: '/x' }] });
    expect(atlas.findNode('jsp', '/jsp/x.jsp')!.meta).toMatchObject({ forms: [{ action: '/x' }] });
  });

  test('linked returns neighbours along an edge kind', () => {
    const login = atlas.findNode('action', '/login')!;
    expect(atlas.linked(login.id, 'renders').map((n) => n.name)).toContain('/jsp/login.jsp');
  });
});

describe('CodeAtlas — search', () => {
  test('finds nodes whose name contains the term token', () => {
    const names = atlas.search('login').map((n) => n.name);
    expect(names).toContain('/login');
    expect(names).toContain('/jsp/login.jsp');
  });

  test('returns nothing for a term that matches no node', () => {
    expect(atlas.search('zzznomatch')).toEqual([]);
  });

  test('honours a result limit', () => {
    expect(atlas.search('jsp', { limit: 1 }).length).toBeLessThanOrEqual(1);
  });
});

describe('CodeAtlas — generated docs', () => {
  test('setNodeDoc/getNodeDoc store and retrieve a summary', () => {
    const id = atlas.findNode('action', '/login')!.id;
    atlas.setNodeDoc(id, 'The login screen collects credentials.');
    expect(atlas.getNodeDoc(id)).toBe('The login screen collects credentials.');
    expect(atlas.findNode('action', '/login')!.doc).toBe('The login screen collects credentials.');
  });

  test('a node with no generated doc reads back null', () => {
    expect(atlas.findNode('action', '/list')!.doc).toBeNull();
  });

  test('search matches generated doc text', () => {
    atlas.setNodeDoc(atlas.findNode('action', '/login')!.id, 'Authentication entry for analysts.');
    expect(atlas.search('analysts').map((n) => n.name)).toContain('/login');
  });
});
