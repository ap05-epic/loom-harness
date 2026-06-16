import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations } from '../db/db.js';
import { MIGRATIONS } from '../db/migrations.js';
import { GateStore } from './gates.js';
import { SkillStore } from '../skills/skills.js';
import { TaskStore } from '../tasks/tasks.js';
import { applyGateDecision } from './decide.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

let dir: string;
let db: SqliteDatabase;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'decide-'));
  db = openDb(join(dir, 'loom.db'));
  runMigrations(db, MIGRATIONS);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('applyGateDecision', () => {
  test('approving a skill gate activates the drafted skill', () => {
    const skills = new SkillStore(db);
    const skill = skills.addSkill({
      name: 'x',
      description: '',
      triggers: [],
      body: '',
      tier: 'generated',
      project: 'demo',
    }); // draft
    const gate = new GateStore(db).open({
      scopeType: 'skill',
      scopeId: skill.id,
      type: 'skill',
      payload: {},
    });
    const r = applyGateDecision(db, gate.id, 'approved');
    expect(r?.activated).toBe(true);
    expect(skills.get(skill.id)!.status).toBe('active');
  });

  test('rejecting a skill gate archives the skill', () => {
    const skills = new SkillStore(db);
    const skill = skills.addSkill({
      name: 'y',
      description: '',
      triggers: [],
      body: '',
      tier: 'generated',
      project: 'demo',
    });
    const gate = new GateStore(db).open({
      scopeType: 'skill',
      scopeId: skill.id,
      type: 'skill',
      payload: {},
    });
    const r = applyGateDecision(db, gate.id, 'rejected');
    expect(r?.archived).toBe(true);
    expect(skills.get(skill.id)!.status).toBe('archived');
  });

  test('approving a ship gate marks the work package shipped', () => {
    const tasks = new TaskStore(db);
    const run = tasks.createRun({ project: 'demo' });
    const wp = tasks.createWorkPackage({ runId: run.id, title: 't', screenKey: 's', spec: {} });
    tasks.setWorkPackageState(wp.id, 'passed');
    const gate = new GateStore(db).open({
      scopeType: 'wp',
      scopeId: wp.id,
      type: 'ship',
      payload: {},
    });
    const r = applyGateDecision(db, gate.id, 'approved');
    expect(r?.shipped).toBe(true);
    expect(tasks.getWorkPackage(wp.id)!.state).toBe('shipped');
  });

  test('returns null for an unknown or already-decided gate', () => {
    expect(applyGateDecision(db, 'nope', 'approved')).toBeNull();
  });
});
