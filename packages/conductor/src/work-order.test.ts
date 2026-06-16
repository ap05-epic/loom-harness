import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ingestLegacyWebapp,
  openCodeAtlas,
  parseJsp,
  parseStrutsConfig,
  parseTilesDefs,
  parseWebXml,
  type CodeAtlas,
  type Screen,
} from '@loom/cartographer';
import { openDb, runMigrations, MIGRATIONS, MemoryStore, SkillStore } from '@loom/core';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildWorkOrder } from './work-order.js';

const LEGACY_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
);
const read = (p: string) => readFileSync(join(LEGACY_SRC, p), 'utf8');
const jspSource = (logicalPath: string): string | undefined => {
  try {
    return read(logicalPath.replace(/^\//, ''));
  } catch {
    return undefined;
  }
};

let dir: string;
let atlas: CodeAtlas;
let login: Screen;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'workorder-'));
  atlas = openCodeAtlas(join(dir, 'codeatlas.db'));
  ingestLegacyWebapp(atlas, {
    struts: parseStrutsConfig(read('WEB-INF/struts-config.xml')),
    tiles: parseTilesDefs(read('WEB-INF/tiles-defs.xml')),
    web: parseWebXml(read('WEB-INF/web.xml')),
    jsps: ['jsp/login.jsp', 'jsp/list.jsp'].map((rel) => ({
      path: `/${rel}`,
      info: parseJsp(read(rel)),
    })),
  });
  login = atlas.screens().find((s) => s.key === 'login')!;
});
afterEach(() => {
  atlas.close();
  rmSync(dir, { recursive: true, force: true });
});

test('work order carries the legacy facts and form fields', () => {
  const wo = buildWorkOrder(atlas, login, { jspSource }).text;
  expect(wo).toContain('rebuild the "login" screen');
  expect(wo).toContain('com.example.legacy.web.action.LoginAction');
  expect(wo).toContain('username');
  expect(wo).toContain('password');
});

test('work order embeds the real legacy JSP source', () => {
  const wo = buildWorkOrder(atlas, login, { jspSource }).text;
  expect(wo).toContain('html:text');
  expect(wo).toContain('/jsp/login.jsp');
});

test('work order includes the recovered documentation when present', () => {
  atlas.setNodeDoc(atlas.findNode('action', '/login')!.id, 'Signs analysts into the pipeline.');
  expect(buildWorkOrder(atlas, login, { jspSource }).text).toContain(
    'Signs analysts into the pipeline.',
  );
});

test('work order includes the repo-map when provided', () => {
  const wo = buildWorkOrder(atlas, login, { repoMap: '# app — code map\n- login /login' }).text;
  expect(wo).toContain('App context');
  expect(wo).toContain('code map');
});

test('degrades gracefully with no doc, JSP source, or repo-map', () => {
  const wo = buildWorkOrder(atlas, login, {}).text;
  expect(wo).toContain('rebuild the "login" screen');
  expect(wo).not.toContain('```jsp');
});

test('recalls active skills + project memory into the order when stores are provided', () => {
  const hdb = openDb(join(dir, 'harness.db'));
  runMigrations(hdb, MIGRATIONS);
  const skills = new SkillStore(hdb);
  const memory = new MemoryStore(hdb);
  // matches the login screen's terms (key 'login', form field 'password')
  skills.addSkill({
    name: 'session-auth-form',
    description: 'reproduce the login form and session cookie',
    triggers: ['login', 'password'],
    body: 'Keep the password field type=password.',
    tier: 'bundled',
    status: 'active',
  });
  skills.addSkill({
    name: 'draft-only',
    description: 'login draft',
    triggers: ['login'],
    body: 'x',
    tier: 'generated',
    project: 'demo',
    status: 'draft', // excluded — not active
  });
  memory.remember({
    project: 'demo',
    kind: 'project_fact',
    title: 'Login endpoint',
    body: 'login posts to the auth action',
  });

  const wo = buildWorkOrder(atlas, login, {
    jspSource,
    recall: { skills, memory, project: 'demo' },
  }).text;

  expect(wo).toContain('Relevant skills');
  expect(wo).toContain('session-auth-form');
  expect(wo).toContain('type=password'); // skill body made it in
  expect(wo).not.toContain('draft-only'); // drafts never recalled
  expect(wo).toContain('Project memory');
  expect(wo).toContain('login posts to the auth action');
  hdb.close();
});

test('surfaces the ids of the active skills it recalled (for usage accounting)', () => {
  const hdb = openDb(join(dir, 'harness-ids.db'));
  runMigrations(hdb, MIGRATIONS);
  const skills = new SkillStore(hdb);
  const memory = new MemoryStore(hdb);
  const active = skills.addSkill({
    name: 'session-auth-form',
    description: 'reproduce the login form',
    triggers: ['login', 'password'],
    body: 'x',
    tier: 'bundled',
    status: 'active',
  });
  skills.addSkill({
    name: 'draft-login',
    description: 'login draft',
    triggers: ['login'],
    body: 'x',
    tier: 'generated',
    project: 'demo',
    status: 'draft', // never recalled → never accounted for use
  });
  const { recalledSkillIds } = buildWorkOrder(atlas, login, {
    recall: { skills, memory, project: 'demo' },
  });
  expect(recalledSkillIds).toEqual([active.id]); // only the active skill, by id
  hdb.close();
});

test('no recall sections when stores have nothing relevant', () => {
  const hdb = openDb(join(dir, 'harness-empty.db'));
  runMigrations(hdb, MIGRATIONS);
  const wo = buildWorkOrder(atlas, login, {
    recall: { skills: new SkillStore(hdb), memory: new MemoryStore(hdb), project: 'demo' },
  }).text;
  expect(wo).not.toContain('Relevant skills');
  expect(wo).not.toContain('Project memory');
  expect(wo).toContain('rebuild the "login" screen');
  hdb.close();
});
