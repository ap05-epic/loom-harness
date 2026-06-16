import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, openDb, runMigrations, SkillStore, type SqliteDatabase } from '@loom/core';
import { writeSkillFile } from '@loom/skills';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { inventory } from './inventory.js';

let dir: string;
let db: SqliteDatabase;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-inv-'));
  db = openDb(join(dir, 'loom.db'));
  runMigrations(db, MIGRATIONS);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A fake DIGIT/Copilot home with one skill, one agent, and an MCP config. */
function seedDigitHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'digit-'));
  writeSkillFile(join(home, 'skills'), {
    name: 'shared-grid',
    description: 'a colleague skill',
    triggers: ['grid'],
    body: '...',
  });
  mkdirSync(join(home, 'agents'), { recursive: true });
  writeFileSync(join(home, 'agents', 'analyst.agent.md'), '---\nname: analyst\n---\nbody');
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ mcpServers: { figma: { command: 'x' }, playwright: { command: 'y' } } }),
  );
  return home;
}

describe('inventory', () => {
  test('assembles tools, DB + file skills, external MCP, and the DIGIT home', () => {
    const skills = new SkillStore(db);
    skills.addSkill({
      name: 'tiles-layout',
      description: 'tiles → layout',
      triggers: ['tiles'],
      body: '',
      tier: 'bundled',
      status: 'active',
    });
    const skillsDir = mkdtempSync(join(tmpdir(), 'skillsdir-'));
    writeSkillFile(skillsDir, {
      name: 'popup-modal',
      description: 'popup → modal',
      triggers: ['popup'],
      body: '',
    });
    const digitHome = seedDigitHome();

    const inv = inventory(db, {
      skillsDir,
      digitHome,
      externalMcp: [{ name: 'supabase', description: 'db' }],
    });

    // built-in tools (curated, real capabilities)
    expect(inv.tools.map((t) => t.name)).toContain('write_file');
    expect(inv.tools.some((t) => t.category === 'knowledge')).toBe(true);
    // skills: the DB one (source db) + the file one (source file)
    expect(inv.skills.find((s) => s.name === 'tiles-layout')?.source).toBe('db');
    expect(inv.skills.find((s) => s.name === 'popup-modal')?.source).toBe('file');
    // external MCP (consumed)
    expect(inv.mcpExternal.map((m) => m.name)).toEqual(['supabase']);
    // DIGIT home scan
    expect(inv.digit.skills.map((s) => s.name)).toContain('shared-grid');
    expect(inv.digit.agents.map((a) => a.name)).toEqual(['analyst']);
    expect(inv.digit.mcp.map((m) => m.name).sort()).toEqual(['figma', 'playwright']);

    rmSync(skillsDir, { recursive: true, force: true });
    rmSync(digitHome, { recursive: true, force: true });
  });

  test('a file skill whose name a DB skill already covers is not duplicated', () => {
    const skills = new SkillStore(db);
    skills.addSkill({
      name: 'dupe',
      description: 'db version',
      triggers: [],
      body: '',
      tier: 'generated',
      project: 'demo',
    });
    const skillsDir = mkdtempSync(join(tmpdir(), 'skillsdir2-'));
    writeSkillFile(skillsDir, {
      name: 'dupe',
      description: 'file version',
      triggers: [],
      body: '',
    });

    const inv = inventory(db, { skillsDir, digitHome: join(tmpdir(), 'no-such-digit') });

    expect(inv.skills.filter((s) => s.name === 'dupe')).toHaveLength(1);
    expect(inv.skills.find((s) => s.name === 'dupe')?.source).toBe('db');
    expect(inv.digit.skills).toEqual([]); // missing DIGIT home degrades to empty
    rmSync(skillsDir, { recursive: true, force: true });
  });
});
