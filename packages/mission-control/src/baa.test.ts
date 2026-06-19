import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  EventLog,
  GateStore,
  MIGRATIONS,
  openDb,
  runMigrations,
  TaskStore,
  type SqliteDatabase,
} from '@loom/core';
import { baaState } from './read-model.js';
import { startMissionControl, type MissionControl } from './index.js';

let db: SqliteDatabase;
beforeEach(() => {
  db = openDb(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('baaState read-model', () => {
  test('all nodes idle when there is no run', () => {
    const s = baaState(db);
    expect(s.run).toBeNull();
    expect(s.stages.map.status).toBe('idle');
    expect(s.stages.build.status).toBe('idle');
  });

  test('derives node status from run stage, WP states, events, and gates', () => {
    const tasks = new TaskStore(db);
    const events = new EventLog(db);
    const run = tasks.createRun({ project: 'baa' });
    tasks.setRunStage(run.id, 'build');
    events.append({
      type: 'map.completed',
      runId: run.id,
      payload: { screens: ['login', 'list'], targets: ['login', 'list'] },
    });
    const wp1 = tasks.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Login' });
    const wp2 = tasks.createWorkPackage({ runId: run.id, screenKey: 'list', title: 'List' });
    events.append({ type: 'crawl.captured', runId: run.id, wpId: wp1.id, payload: {} });
    events.append({ type: 'crawl.captured', runId: run.id, wpId: wp2.id, payload: {} });
    tasks.setWorkPackageState(wp1.id, 'passed');
    tasks.setWorkPackageState(wp2.id, 'building');

    const s = baaState(db, run.id);
    expect(s.stages.map.status).toBe('green');
    expect(s.stages.plan.status).toBe('green'); // two screens planned
    expect(s.stages.crawl.status).toBe('green'); // two baselines == two WPs
    expect(s.stages.build.status).toBe('running'); // one building
    expect(s.stages.ship.status).toBe('idle');
  });

  test('surfaces a plan gate (stuck plan) and a blocked screen (stuck build)', () => {
    const tasks = new TaskStore(db);
    const run = tasks.createRun({ project: 'baa' });
    const wp = tasks.createWorkPackage({ runId: run.id, screenKey: 'login', title: 'Login' });
    new GateStore(db).open({ scopeType: 'run', scopeId: run.id, type: 'plan' });

    const s = baaState(db, run.id);
    expect(s.stages.plan.status).toBe('stuck');
    expect(s.gates.some((g) => g.type === 'plan')).toBe(true);

    tasks.setWorkPackageState(wp.id, 'blocked');
    expect(baaState(db, run.id).stages.build.status).toBe('stuck');
  });
});

describe('BAA endpoints', () => {
  let mc: MissionControl;
  afterEach(async () => {
    await mc?.stop();
  });

  test('POST /api/baa/stage triggers the spawner; GET /api/baa-state reads the graph', async () => {
    const calls: Array<{ stage: string; runId?: string }> = [];
    mc = await startMissionControl({
      db,
      baa: {
        spawnStage: (stage, runId) => {
          calls.push({ stage, runId });
          return { pid: 123 };
        },
      },
    });
    const res = await fetch(`${mc.url}/api/baa/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage: 'map' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { started: boolean }).started).toBe(true);
    expect(calls).toEqual([{ stage: 'map', runId: undefined }]);

    // an unknown stage is rejected
    const bad = await fetch(`${mc.url}/api/baa/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage: 'nope' }),
    });
    expect(bad.status).toBe(400);

    const state = (await (await fetch(`${mc.url}/api/baa-state`)).json()) as {
      stages: Record<string, unknown>;
    };
    expect(state.stages.map).toBeDefined();
  });

  test('POST /api/baa/stage is 503 when no spawner is configured', async () => {
    mc = await startMissionControl({ db });
    const res = await fetch(`${mc.url}/api/baa/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage: 'map' }),
    });
    expect(res.status).toBe(503);
  });

  test('POST /api/baa/stop halts the run — stops it and blocks in-flight work packages', async () => {
    const tasks = new TaskStore(db);
    const run = tasks.createRun({ project: 'baa' });
    const building = tasks.createWorkPackage({ runId: run.id, screenKey: 'a', title: 'A' });
    const passed = tasks.createWorkPackage({ runId: run.id, screenKey: 'b', title: 'B' });
    tasks.setWorkPackageState(building.id, 'building');
    tasks.setWorkPackageState(passed.id, 'passed');
    mc = await startMissionControl({ db, project: 'baa' });

    const res = await fetch(`${mc.url}/api/baa/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: run.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { halted: number; runId: string };
    expect(body.halted).toBe(1); // only the in-flight (building) WP
    expect(body.runId).toBe(run.id);

    expect(tasks.getRun(run.id)!.status).toBe('stopped');
    expect(tasks.getWorkPackage(building.id)!.state).toBe('blocked');
    expect(tasks.getWorkPackage(passed.id)!.state).toBe('passed'); // a finished WP is untouched
  });
});
