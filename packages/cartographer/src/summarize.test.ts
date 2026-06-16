import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAiDriver } from '@loom/agents';
import { MockLlmServer } from '@loom/test-kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openCodeAtlas, type CodeAtlas } from './codeatlas.js';
import { ingestLegacyWebapp, type LegacySources } from './map.js';
import { summarizeScreens } from './summarize.js';
import { parseStrutsConfig } from './struts-parser.js';
import { parseTilesDefs } from './tiles-parser.js';
import { parseWebXml } from './webxml-parser.js';
import { parseJsp } from './jsp-parser.js';

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
  dir = mkdtempSync(join(tmpdir(), 'summarize-'));
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

describe('summarizeScreens', () => {
  test('writes an LLM-generated doc per screen and reports usage', async () => {
    mock.enqueueText('Collects analyst credentials and signs in to the pipeline.', {
      repeat: true,
    });

    const result = await summarizeScreens(atlas, { gateway, model: 'mock' });

    expect(result.screensSummarized).toBe(5);
    expect(result.outputTokens).toBeGreaterThan(0);
    const login = atlas.findNode('action', '/login')!;
    expect(atlas.getNodeDoc(login.id)).toContain('credentials');
  });

  test('grounds the prompt in the screen’s real forms + fields', async () => {
    mock.enqueueText('ok', { repeat: true });

    await summarizeScreens(atlas, { gateway, model: 'mock' });

    const loginReq = mock.requests.find((r) => {
      const text = JSON.stringify(r.body.messages);
      return text.includes('/login') && text.includes('username') && text.includes('password');
    });
    expect(loginReq).toBeDefined();
  });

  test('generated docs become searchable', async () => {
    mock.enqueueText('Authentication entry point for analysts.', { repeat: true });
    await summarizeScreens(atlas, { gateway, model: 'mock' });
    expect(atlas.search('analysts').map((n) => n.name)).toContain('/login');
  });

  test('skips empty completions without writing a doc', async () => {
    mock.enqueueText('', { repeat: true });
    const result = await summarizeScreens(atlas, { gateway, model: 'mock' });
    expect(result.screensSummarized).toBe(0);
    expect(atlas.getNodeDoc(atlas.findNode('action', '/login')!.id)).toBeNull();
  });
});
