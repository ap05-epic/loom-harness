import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
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
});
