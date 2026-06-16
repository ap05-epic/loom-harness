import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parseJsp } from './jsp-parser.js';

const JSP_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
  'jsp',
);
const readJsp = (name: string): string => readFileSync(join(JSP_DIR, name), 'utf8');

describe('parseJsp — taglibs', () => {
  test('extracts taglib uri/prefix declarations', () => {
    const info = parseJsp(readJsp('list.jsp'));
    expect(info.taglibs).toContainEqual({
      uri: 'http://struts.apache.org/tags-html',
      prefix: 'html',
    });
    expect(info.taglibs.map((t) => t.prefix).sort()).toEqual(['bean', 'c', 'fmt', 'html', 'logic']);
  });
});

describe('parseJsp — forms and fields', () => {
  test('recovers a form action and its fields with types', () => {
    const info = parseJsp(readJsp('login.jsp'));
    expect(info.forms).toHaveLength(1);
    const form = info.forms[0]!;
    expect(form.action).toBe('/login');
    expect(form.fields).toContainEqual({ tag: 'text', property: 'username' });
    expect(form.fields).toContainEqual({ tag: 'password', property: 'password' });
  });

  test('captures select options as a field with its option values', () => {
    const info = parseJsp(readJsp('list.jsp'));
    const select = info.forms[0]!.fields.find((f) => f.tag === 'select');
    expect(select?.property).toBe('region');
    expect(select?.options).toEqual(['', 'EMEA', 'APAC', 'AMER']);
  });

  test('reads the form method (defaults to post)', () => {
    expect(parseJsp(readJsp('list.jsp')).forms[0]!.method).toBe('get');
    expect(parseJsp(readJsp('login.jsp')).forms[0]!.method).toBe('post');
  });
});

describe('parseJsp — navigation links', () => {
  test('collects action targets from html:link and html:rewrite', () => {
    const info = parseJsp(readJsp('list.jsp'));
    expect(info.links).toContain('/wizard');
    expect(info.links).toContain('/popup');
  });

  test('header fragment links to the main nav actions', () => {
    const info = parseJsp(readJsp('fragments/header.jsp'));
    expect(info.links.sort()).toEqual(['/list', '/logout', '/wizard']);
  });
});

describe('parseJsp — iterations', () => {
  test('recovers logic:iterate name + backing model type', () => {
    const info = parseJsp(readJsp('list.jsp'));
    expect(info.iterations).toContainEqual({
      name: 'deals',
      type: 'com.example.legacy.web.model.Deal',
    });
  });
});

describe('parseJsp — includes', () => {
  test('captures directive and action includes', () => {
    const info = parseJsp(
      `<%@ include file="/jsp/fragments/header.jsp" %><jsp:include page="/jsp/foot.jsp"/>`,
    );
    expect(info.includes).toEqual(['/jsp/fragments/header.jsp', '/jsp/foot.jsp']);
  });

  test('a fragment with no forms or iterations parses to empty arrays', () => {
    const info = parseJsp(readJsp('fragments/footer.jsp'));
    expect(info.forms).toEqual([]);
    expect(info.iterations).toEqual([]);
    expect(info.links).toEqual([]);
  });
});
