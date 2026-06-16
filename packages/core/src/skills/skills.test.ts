import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations } from '../db/db.js';
import { MIGRATIONS } from '../db/migrations.js';
import { SkillStore } from './skills.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

let dir: string;
let db: SqliteDatabase;
let store: SkillStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skills-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
  store = new SkillStore(db);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SkillStore', () => {
  test('adds a skill and reads it back with its triggers', () => {
    const s = store.addSkill({
      name: 'struts-table-to-react',
      description: 'Convert <logic:iterate> tables to a React table',
      triggers: ['logic:iterate', 'table', 'grid'],
      body: '1. Identify the iterate tag...',
      tier: 'bundled',
      status: 'active',
    });
    expect(s.id).toMatch(/^skill_/);
    const got = store.get(s.id)!;
    expect(got.name).toBe('struts-table-to-react');
    expect(got.triggers).toEqual(['logic:iterate', 'table', 'grid']);
    expect(got.tier).toBe('bundled');
    expect(got.status).toBe('active');
    expect(got.useCount).toBe(0);
    expect(got.successCount).toBe(0);
  });

  test('a generated skill defaults to draft (awaits approval)', () => {
    const s = store.addSkill({
      name: 'wizard-flow',
      description: 'multi-step wizard',
      triggers: ['wizard'],
      body: '',
      tier: 'generated',
      project: 'demo',
    });
    expect(s.status).toBe('draft');
  });

  test('recall returns only active skills, ranked by overlap, across global + project scope', () => {
    store.addSkill({
      name: 'tiles-layout',
      description: 'Tiles layout to a React layout component',
      triggers: ['tiles', 'layout'],
      body: '',
      tier: 'bundled',
      status: 'active',
    }); // global, matches both terms (score 2)
    store.addSkill({
      name: 'layout-helper',
      description: 'shared layout helper',
      triggers: ['layout'],
      body: '',
      tier: 'project',
      project: 'demo',
      status: 'active',
    }); // project demo, matches one term (score 1)
    store.addSkill({
      name: 'draft-tiles',
      description: 'tiles layout',
      triggers: ['tiles', 'layout'],
      body: '',
      tier: 'generated',
      project: 'demo',
      status: 'draft',
    }); // excluded — draft
    store.addSkill({
      name: 'other-tiles',
      description: 'tiles layout',
      triggers: ['tiles', 'layout'],
      body: '',
      tier: 'project',
      project: 'other',
      status: 'active',
    }); // excluded — different project

    const hits = store.recall('demo', { terms: ['tiles', 'layout'] });
    expect(hits.map((s) => s.name)).toEqual(['tiles-layout', 'layout-helper']);
  });

  test('a draft skill becomes recallable once activated', () => {
    const s = store.addSkill({
      name: 'popup-modal',
      description: 'legacy popup to a modal',
      triggers: ['popup', 'modal'],
      body: '',
      tier: 'generated',
      project: 'demo',
    });
    expect(store.recall('demo', { terms: ['popup'] })).toHaveLength(0);
    store.setStatus(s.id, 'active');
    expect(store.recall('demo', { terms: ['popup'] }).map((x) => x.name)).toEqual(['popup-modal']);
  });

  test('list returns all skills (name order), filterable by status and project (+ global)', () => {
    store.addSkill({
      name: 'alpha',
      description: '',
      triggers: [],
      body: '',
      tier: 'bundled',
      status: 'active',
    }); // global active
    store.addSkill({
      name: 'beta',
      description: '',
      triggers: [],
      body: '',
      tier: 'generated',
      project: 'demo',
    }); // demo draft
    store.addSkill({
      name: 'gamma',
      description: '',
      triggers: [],
      body: '',
      tier: 'project',
      project: 'other',
      status: 'active',
    }); // other active

    expect(store.list().map((s) => s.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(store.list({ status: 'active' }).map((s) => s.name)).toEqual(['alpha', 'gamma']);
    expect(store.list({ project: 'demo' }).map((s) => s.name)).toEqual(['alpha', 'beta']); // global + demo
  });

  test('recordUse tracks usage and successes (is the self-improvement loop compounding?)', () => {
    const s = store.addSkill({
      name: 'x',
      description: '',
      triggers: [],
      body: '',
      tier: 'bundled',
      status: 'active',
    });
    store.recordUse(s.id, { success: true });
    store.recordUse(s.id, { success: false });
    store.recordUse(s.id, { success: true });
    const got = store.get(s.id)!;
    expect(got.useCount).toBe(3);
    expect(got.successCount).toBe(2);
  });

  test('auto-promotes a proven active generated skill to the bundled tier after N successes', () => {
    const s = store.addSkill({
      name: 'wizard-flow',
      description: 'multi-step wizard to a React stepper',
      triggers: ['wizard'],
      body: '...',
      tier: 'generated',
      project: 'demo',
      status: 'active', // already human-approved at the skill gate
    });
    // Below the threshold of 3 — still a project-scoped generated skill.
    expect(store.recordUse(s.id, { success: true }, { promoteAfter: 3 }).promoted).toBe(false);
    expect(store.recordUse(s.id, { success: true }, { promoteAfter: 3 }).promoted).toBe(false);
    expect(store.get(s.id)!.tier).toBe('generated');
    // The third success crosses the threshold → promote to the bundled (global) tier.
    const r3 = store.recordUse(s.id, { success: true }, { promoteAfter: 3 });
    expect(r3.promoted).toBe(true);
    expect(r3.skill.tier).toBe('bundled');
    const got = store.get(s.id)!;
    expect(got.tier).toBe('bundled');
    expect(got.project).toBeNull(); // now shared across every project
    expect(got.status).toBe('active');
    // Already bundled — a further success is not a fresh promotion.
    expect(store.recordUse(s.id, { success: true }, { promoteAfter: 3 }).promoted).toBe(false);
  });

  test('never auto-promotes a draft skill — the human-approval gate is never skipped', () => {
    const s = store.addSkill({
      name: 'unapproved',
      description: 'drafted by the Reflector but never approved',
      triggers: ['x'],
      body: '',
      tier: 'generated',
      project: 'demo',
    }); // defaults to draft
    for (let i = 0; i < 10; i++) {
      expect(store.recordUse(s.id, { success: true }, { promoteAfter: 3 }).promoted).toBe(false);
    }
    const got = store.get(s.id)!;
    expect(got.tier).toBe('generated');
    expect(got.status).toBe('draft');
  });

  test('only successes count toward promotion (failures never advance the threshold)', () => {
    const s = store.addSkill({
      name: 'flaky',
      description: 'sometimes works',
      triggers: ['y'],
      body: '',
      tier: 'generated',
      project: 'demo',
      status: 'active',
    });
    store.recordUse(s.id, { success: true }, { promoteAfter: 2 });
    // A failure must not tip a 1-success skill over a threshold of 2.
    expect(store.recordUse(s.id, { success: false }, { promoteAfter: 2 }).promoted).toBe(false);
    expect(store.get(s.id)!.tier).toBe('generated');
    // The next real success reaches 2 → promoted.
    expect(store.recordUse(s.id, { success: true }, { promoteAfter: 2 }).promoted).toBe(true);
    expect(store.get(s.id)!.tier).toBe('bundled');
  });

  test('does not promote a project-tier skill (its conventions stay project-scoped)', () => {
    const s = store.addSkill({
      name: 'project-date-format',
      description: 'project-specific date convention',
      triggers: ['date'],
      body: '',
      tier: 'project',
      project: 'demo',
      status: 'active',
    });
    for (let i = 0; i < 5; i++) {
      expect(store.recordUse(s.id, { success: true }, { promoteAfter: 2 }).promoted).toBe(false);
    }
    const got = store.get(s.id)!;
    expect(got.tier).toBe('project');
    expect(got.project).toBe('demo'); // never leaks to the global tier
  });
});
