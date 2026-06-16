import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations, MIGRATIONS, MemoryStore, SkillStore } from '@loom/core';
import type { SqliteDatabase } from '@loom/core';
import { parseSkillMd } from '@loom/skills';
import { recallForWorkOrder } from './recall.js';

let dir: string;
let db: SqliteDatabase;
let stores: { skills: SkillStore; memory: MemoryStore };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'recall-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
  stores = { skills: new SkillStore(db), memory: new MemoryStore(db) };
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('recallForWorkOrder', () => {
  test('assembles relevant active skills + project memory + this WP worklog into slots', () => {
    stores.skills.addSkill({
      name: 'tiles-layout',
      description: 'Tiles layout to a React layout component',
      triggers: ['tiles', 'layout'],
      body: '1. Map the layout def to a <Layout> component.',
      tier: 'bundled',
      status: 'active',
    });
    stores.skills.addSkill({
      name: 'draft-skill',
      description: 'tiles layout draft',
      triggers: ['tiles'],
      body: 'x',
      tier: 'generated',
      project: 'demo',
      status: 'draft', // excluded — not active
    });
    stores.memory.remember({
      project: 'demo',
      kind: 'project_fact',
      title: 'Date format',
      body: 'All dates render dd.MM.yyyy',
    });
    stores.memory.remember({
      project: 'demo',
      kind: 'worklog',
      scopeId: 'wp_1',
      title: 'Attempt 1',
      body: 'tried inline styles; failed the style gate',
    });

    const ctx = recallForWorkOrder(stores, {
      project: 'demo',
      terms: ['tiles', 'layout', 'date'],
      wpId: 'wp_1',
    });

    expect(ctx.skills.map((s) => s.name)).toEqual(['tiles-layout']);
    expect(ctx.facts.map((m) => m.title)).toEqual(['Date format']);
    expect(ctx.worklog).toHaveLength(1);

    const skillSlot = ctx.slots.find((s) => s.name === 'Relevant skills')!;
    expect(skillSlot.content).toContain('tiles-layout');
    expect(skillSlot.content).toContain('<Layout>');
    expect(skillSlot.shrink).toBe('truncate');

    const memSlot = ctx.slots.find((s) => s.name === 'Project memory')!;
    expect(memSlot.content).toContain('dd.MM.yyyy');
    expect(memSlot.content).toContain('failed the style gate');
    // skills outrank memory in the shrink ladder (lower priority number = packed first).
    expect(skillSlot.priority).toBeLessThan(memSlot.priority);
  });

  test('emits no slots when nothing is relevant', () => {
    stores.skills.addSkill({
      name: 'unrelated',
      description: 'something else',
      triggers: ['zzz'],
      body: '',
      tier: 'bundled',
      status: 'active',
    });
    const ctx = recallForWorkOrder(stores, { project: 'demo', terms: ['tiles'] });
    expect(ctx.skills).toEqual([]);
    expect(ctx.facts).toEqual([]);
    expect(ctx.worklog).toEqual([]);
    expect(ctx.slots).toEqual([]);
  });

  test('a memory slot is still produced from the worklog alone (no fact matches)', () => {
    stores.memory.remember({
      project: 'demo',
      kind: 'worklog',
      scopeId: 'wp_9',
      title: 'Note',
      body: 'the popup needs a focus trap',
    });
    const ctx = recallForWorkOrder(stores, { project: 'demo', terms: ['nomatch'], wpId: 'wp_9' });
    expect(ctx.facts).toEqual([]);
    expect(ctx.worklog).toHaveLength(1);
    const memSlot = ctx.slots.find((s) => s.name === 'Project memory')!;
    expect(memSlot.content).toContain('focus trap');
    expect(ctx.slots.some((s) => s.name === 'Relevant skills')).toBe(false);
  });

  test('ranks bundled file-skills into the skill slot alongside DB skills', () => {
    const bundledSkills = [
      parseSkillMd(
        '---\nname: frameset-layout\ndescription: Frameset to a modern layout\ntriggers: [frameset, layout]\n---\nReplace the frameset with a CSS grid.',
      ),
      parseSkillMd('---\nname: unrelated\ndescription: nope\ntriggers: [zzz]\n---\nx'),
    ];
    const ctx = recallForWorkOrder(stores, {
      project: 'demo',
      terms: ['frameset'],
      bundledSkills,
    });
    expect(ctx.bundled.map((d) => d.name)).toEqual(['frameset-layout']); // unrelated dropped
    const skillSlot = ctx.slots.find((s) => s.name === 'Relevant skills')!;
    expect(skillSlot.content).toContain('frameset-layout');
    expect(skillSlot.content).toContain('CSS grid');
  });
});
