import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EventLog,
  GateStore,
  MIGRATIONS,
  openDb,
  QuestionStore,
  runMigrations,
  SkillStore,
  TaskStore,
  type SqliteDatabase,
} from '@loom/core';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startMissionControl, type MissionControl } from './server.js';

let dir: string;
let db: SqliteDatabase;
let mc: MissionControl;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-server-'));
  db = openDb(join(dir, 'loom.db'));
  runMigrations(db, MIGRATIONS);
});
afterEach(async () => {
  await mc.stop();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Seed a run with an open ship gate and an open question; returns their ids. */
function seed(): { runId: string; gateId: string; questionId: string } {
  const tasks = new TaskStore(db);
  const run = tasks.createRun({ project: 'fixture' });
  tasks.setRunStage(run.id, 'build');
  const wp = tasks.createWorkPackage({
    runId: run.id,
    title: 'login',
    screenKey: 'login',
    spec: {},
  });
  tasks.setWorkPackageState(wp.id, 'passed');
  const gate = new GateStore(db).open({
    scopeType: 'wp',
    scopeId: wp.id,
    type: 'ship',
    payload: { screenKey: 'login' },
  });
  const q = new QuestionStore(db).ask({ runId: run.id, wpId: wp.id, question: 'Proceed?' });
  return { runId: run.id, gateId: gate.id, questionId: q.id };
}

describe('Mission Control server', () => {
  test('serves the themed HTML dashboard at /', async () => {
    mc = await startMissionControl({ db });
    const res = await fetch(`${mc.url}/`);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Mission Control');
    expect(html).toContain('/api/state'); // the state poller is wired
    expect(html).toContain('/api/inventory'); // the inventory poller is wired
    expect(html).toContain('Skills'); // the new inventory panels
    expect(html).toContain('DIGIT library');
    expect(html).toContain('data-theme'); // light/dark theming
  });

  test('serves the dashboard state as JSON', async () => {
    const { runId } = seed();
    mc = await startMissionControl({ db });
    const state = (await (await fetch(`${mc.url}/api/state`)).json()) as {
      run: { id: string } | null;
      gates: unknown[];
      questions: unknown[];
    };
    expect(state.run?.id).toBe(runId);
    expect(state.gates).toHaveLength(1);
    expect(state.questions).toHaveLength(1);
  });

  test('approves a gate via POST — the only kind of write it performs', async () => {
    const { gateId } = seed();
    mc = await startMissionControl({ db });
    const res = await fetch(`${mc.url}/api/gates/${gateId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('approved');
    // …and it's no longer open in the inbox.
    expect(new GateStore(db).list({ status: 'open' })).toHaveLength(0);
  });

  test('answers a question via POST', async () => {
    const { questionId } = seed();
    mc = await startMissionControl({ db });
    const res = await fetch(`${mc.url}/api/questions/${questionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: 'skip it' }),
    });
    expect(res.status).toBe(200);
    expect(new QuestionStore(db).get(questionId)!.answer).toBe('skip it');
  });

  test('POST /api/setup writes loom.config.yaml so the wizard creates the project', async () => {
    mc = await startMissionControl({ db, setupDir: dir });
    const res = await fetch(`${mc.url}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        config: 'project: BAA-Test-2\nllm:\n  driver: openai\n  model: gpt-5.4\n',
      }),
    });
    expect(res.status).toBe(200);
    const path = join(dir, 'loom.config.yaml');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('project: BAA-Test-2');
  });

  test('POST /api/setup is 503 when no setup dir is configured', async () => {
    mc = await startMissionControl({ db });
    const res = await fetch(`${mc.url}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: 'project: x' }),
    });
    expect(res.status).toBe(503);
  });

  test('chat 503 carries the disabledReason so the UI can explain WHY chat is off', async () => {
    mc = await startMissionControl({ db, chatDisabledReason: 'no API key (LLM_API_KEY) in .env' });
    const res = await fetch(`${mc.url}/api/chat/info`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { disabledReason?: string };
    expect(body.disabledReason).toContain('no API key');
  });

  test('a busy port rejects with an actionable message (no unhandled crash)', async () => {
    mc = await startMissionControl({ db, port: 0 });
    const db2 = openDb(':memory:');
    runMigrations(db2, MIGRATIONS);
    await expect(startMissionControl({ db: db2, port: mc.port })).rejects.toThrow(/already in use/);
    db2.close();
  });

  test('approving a skill gate via the API activates the drafted skill (human-in-the-loop)', async () => {
    const skills = new SkillStore(db);
    const skill = skills.addSkill({
      name: 'wizard-flow',
      description: 'multi-step wizard',
      triggers: ['wizard'],
      body: '...',
      tier: 'generated',
      project: 'fixture',
    }); // draft
    const gate = new GateStore(db).open({
      scopeType: 'skill',
      scopeId: skill.id,
      type: 'skill',
      payload: { name: 'wizard-flow' },
    });
    mc = await startMissionControl({ db });
    const res = await fetch(`${mc.url}/api/gates/${gate.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { activated: boolean }).activated).toBe(true);
    expect(skills.get(skill.id)!.status).toBe('active'); // the draft is now recallable
  });

  test('serves the tools/skills/MCP/DIGIT inventory as JSON', async () => {
    new SkillStore(db).addSkill({
      name: 'tiles-layout',
      description: 't',
      triggers: [],
      body: '',
      tier: 'bundled',
      status: 'active',
    });
    mc = await startMissionControl({
      db,
      externalMcp: [{ name: 'supabase', description: 'db' }],
      digitHome: join(tmpdir(), 'no-digit-here'),
    });
    const inv = (await (await fetch(`${mc.url}/api/inventory`)).json()) as {
      tools: Array<{ name: string }>;
      skills: Array<{ name: string }>;
      mcpExternal: Array<{ name: string }>;
      digit: { skills: unknown[] };
    };
    expect(inv.tools.map((t) => t.name)).toContain('write_file');
    expect(inv.skills.map((s) => s.name)).toContain('tiles-layout');
    expect(inv.mcpExternal.map((m) => m.name)).toEqual(['supabase']);
    expect(inv.digit.skills).toEqual([]); // absent DIGIT home → empty, no crash
  });

  test('serves a work package drill-down at /api/wp/:id (404 for unknown)', async () => {
    const tasks = new TaskStore(db);
    const run = tasks.createRun({ project: 'fixture' });
    const wp = tasks.createWorkPackage({ runId: run.id, title: 'x', screenKey: 'login', spec: {} });
    tasks.createAttempt({ wpId: wp.id, role: 'builder', model: 'm', pid: 1 });
    mc = await startMissionControl({ db });
    const detail = (await (await fetch(`${mc.url}/api/wp/${wp.id}`)).json()) as {
      screenKey: string;
      attempts: unknown[];
    };
    expect(detail.screenKey).toBe('login');
    expect(detail.attempts).toHaveLength(1);
    expect((await fetch(`${mc.url}/api/wp/nope`)).status).toBe(404);
  });

  test('rejects a bad gate decision and unknown ids', async () => {
    const { gateId } = seed();
    mc = await startMissionControl({ db });
    const bad = await fetch(`${mc.url}/api/gates/${gateId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'maybe' }),
    });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${mc.url}/api/gates/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(missing.status).toBe(404);
  });

  test('lists the workspace projects and scopes the board by ?project=', async () => {
    const tasks = new TaskStore(db);
    const baa = tasks.createRun({ project: 'baa' });
    tasks.setRunStage(baa.id, 'build');
    const claims = tasks.createRun({ project: 'claims' });
    tasks.setRunStage(claims.id, 'crawl');
    mc = await startMissionControl({ db });

    const projects = (await (await fetch(`${mc.url}/api/projects`)).json()) as {
      projects: string[];
    };
    expect(projects.projects).toEqual(['baa', 'claims']);

    const baaState = (await (await fetch(`${mc.url}/api/state?project=baa`)).json()) as {
      run: { project: string } | null;
    };
    expect(baaState.run?.project).toBe('baa');
    const claimsState = (await (await fetch(`${mc.url}/api/state?project=claims`)).json()) as {
      run: { project: string } | null;
    };
    expect(claimsState.run?.project).toBe('claims');
  });
});

describe('Mission Control — live crawl endpoints', () => {
  test('GET /api/explore returns the crawl; /api/explore-shot serves a PNG and 404s the rest', async () => {
    const tasks = new TaskStore(db);
    const run = tasks.createRun({ project: 'fixture' });
    tasks.setRunStage(run.id, 'explore');
    new EventLog(db).append({
      type: 'explore.started',
      runId: run.id,
      payload: { startUrl: 'http://app/' },
    });
    const shotsDir = join(dir, 'explore-shots');
    mkdirSync(shotsDir, { recursive: true });
    writeFileSync(join(shotsDir, 'abc.png'), Buffer.from('PNGDATA'));

    mc = await startMissionControl({ db, exploreShotsDir: shotsDir });

    const state = (await (await fetch(`${mc.url}/api/explore`)).json()) as {
      run: { id: string } | null;
    };
    expect(state.run?.id).toBe(run.id);

    const shot = await fetch(`${mc.url}/api/explore-shot/abc.png`);
    expect(shot.status).toBe(200);
    expect(shot.headers.get('content-type')).toBe('image/png');

    const missing = await fetch(`${mc.url}/api/explore-shot/nope.png`);
    expect(missing.status).toBe(404);
  });
});

describe('React SPA serving', () => {
  test('serves the built React SPA at / and its assets when the web bundle is present', async () => {
    const webDist = join(dir, 'web-dist');
    mkdirSync(join(webDist, 'assets'), { recursive: true });
    writeFileSync(
      join(webDist, 'index.html'),
      '<!doctype html><html><body><div id="root"></div><script src="./assets/app.js"></script></body></html>',
    );
    writeFileSync(join(webDist, 'assets', 'app.js'), 'console.log("loom spa");');

    mc = await startMissionControl({ db, webDistDir: webDist });

    const root = await fetch(`${mc.url}/`);
    expect(root.headers.get('content-type')).toContain('text/html');
    expect(await root.text()).toContain('id="root"'); // the SPA shell, not vanilla

    const asset = await fetch(`${mc.url}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(await asset.text()).toContain('loom spa');

    // path traversal out of the bundle is refused
    expect((await fetch(`${mc.url}/assets/../../secret`)).status).toBe(404);
  });

  test('falls back to the vanilla dashboard when the SPA is not built', async () => {
    mc = await startMissionControl({ db, webDistDir: join(dir, 'does-not-exist') });
    const html = await (await fetch(`${mc.url}/`)).text();
    expect(html).toContain('Mission Control'); // vanilla dashboardHtml
    expect(html).not.toContain('id="root"'); // …and not the SPA shell
  });

  test('with no webDistDir option, serves vanilla (the documented default)', async () => {
    mc = await startMissionControl({ db });
    const html = await (await fetch(`${mc.url}/`)).text();
    expect(html).toContain('Mission Control');
    expect(html).not.toContain('id="root"');
  });
});
