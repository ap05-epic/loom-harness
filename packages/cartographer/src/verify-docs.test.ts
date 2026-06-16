import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAiDriver } from '@loom/agents';
import { MockLlmServer } from '@loom/test-kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openCodeAtlas, type CodeAtlas } from './codeatlas.js';
import { ingestLegacyWebapp, type LegacySources } from './map.js';
import { parseStrutsConfig } from './struts-parser.js';
import { parseTilesDefs } from './tiles-parser.js';
import { parseWebXml } from './webxml-parser.js';
import { parseJsp } from './jsp-parser.js';
import { verifyScreenDocs } from './verify-docs.js';

const LEGACY_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
);

function sources(): LegacySources {
  const read = (p: string) => readFileSync(join(LEGACY_SRC, p), 'utf8');
  const jspFiles = ['jsp/login.jsp', 'jsp/list.jsp', 'jsp/fragments/header.jsp'];
  return {
    struts: parseStrutsConfig(read('WEB-INF/struts-config.xml')),
    tiles: parseTilesDefs(read('WEB-INF/tiles-defs.xml')),
    web: parseWebXml(read('WEB-INF/web.xml')),
    jsps: jspFiles.map((rel) => ({ path: `/${rel}`, info: parseJsp(read(rel)) })),
  };
}

let dir: string;
let atlas: CodeAtlas;
let mock: MockLlmServer;
let gateway: OpenAiDriver;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'verify-docs-'));
  atlas = openCodeAtlas(join(dir, 'codeatlas.db'));
  ingestLegacyWebapp(atlas, sources());
  mock = new MockLlmServer();
  const { baseUrl } = await mock.start();
  gateway = new OpenAiDriver({ baseUrl, apiKey: 'test' });
});
afterEach(async () => {
  atlas.close();
  await mock.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('verifyScreenDocs', () => {
  test('flags a recovered doc the source does not support (the panel catches it)', async () => {
    // A subtly-wrong doc: claims controls the login screen never had.
    const login = atlas.findNode('action', '/login')!;
    atlas.setNodeDoc(login.id, 'The login screen has a remember-me checkbox and a captcha.');
    // Every judge rejects — the evidence (username/password form) has no such controls.
    mock.enqueueText(JSON.stringify({ ok: false, reason: 'no remember-me/captcha in evidence' }), {
      repeat: true,
    });

    const result = await verifyScreenDocs(atlas, { gateway, model: 'mock' });

    expect(result.verified).toBe(1); // only the doc'd screen was judged
    const flaggedLogin = result.flagged.find((f) => f.screenKey === 'login');
    expect(flaggedLogin).toBeDefined();
    expect(flaggedLogin!.verdict).toBe('fail');
    expect(flaggedLogin!.reasons.length).toBeGreaterThan(0);
  });

  test('does not flag a doc the panel approves', async () => {
    const login = atlas.findNode('action', '/login')!;
    atlas.setNodeDoc(login.id, 'Collects username and password and signs the analyst in.');
    mock.enqueueText(JSON.stringify({ ok: true, reason: 'supported by the form fields' }), {
      repeat: true,
    });

    const result = await verifyScreenDocs(atlas, { gateway, model: 'mock' });

    expect(result.verified).toBe(1);
    expect(result.flagged).toHaveLength(0);
  });

  test('skips screens that have no recovered doc yet', async () => {
    // No docs set at all → nothing to verify, nothing flagged.
    const result = await verifyScreenDocs(atlas, { gateway, model: 'mock' });
    expect(result.verified).toBe(0);
    expect(result.flagged).toHaveLength(0);
  });
});
