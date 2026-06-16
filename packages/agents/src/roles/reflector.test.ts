import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations, MIGRATIONS, MemoryStore, SkillStore } from '@loom/core';
import type { SqliteDatabase } from '@loom/core';
import type { LlmGateway } from '../types.js';
import { buildReflectPrompt, parseReflection, reflect } from './reflector.js';

const stubGateway = (content: string | null): LlmGateway => ({
  complete: async () => ({
    content,
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: 'stop',
  }),
});

let dir: string;
let db: SqliteDatabase;
let stores: { skills: SkillStore; memory: MemoryStore };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reflector-'));
  db = openDb(join(dir, 'harness.db'));
  runMigrations(db, MIGRATIONS);
  stores = { skills: new SkillStore(db), memory: new MemoryStore(db) };
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Reflector', () => {
  test('turns the model output into draft skills + project facts, persisted', async () => {
    const gateway = stubGateway(
      JSON.stringify({
        skills: [
          {
            name: 'struts-table-to-react',
            description: 'Convert <logic:iterate> tables to a React table',
            triggers: ['logic:iterate', 'table'],
            body: '1. Find the iterate tag. 2. ...',
          },
        ],
        facts: [{ title: 'Date format', body: 'All dates render dd.MM.yyyy' }],
      }),
    );

    const result = await reflect(gateway, stores, {
      project: 'demo',
      screen: 'deal-list',
      notes: 'converted the list table; the iterate loop became a <table>',
      model: 'gpt-x',
    });

    expect(result.skills).toHaveLength(1);
    const skill = result.skills[0]!;
    expect(skill.name).toBe('struts-table-to-react');
    expect(skill.tier).toBe('generated');
    expect(skill.status).toBe('draft'); // awaits human approval — not auto-active
    expect(skill.project).toBe('demo');
    // persisted, not just returned
    expect(stores.skills.get(skill.id)!.triggers).toEqual(['logic:iterate', 'table']);

    expect(result.facts).toHaveLength(1);
    const fact = result.facts[0]!;
    expect(fact.kind).toBe('project_fact');
    expect(fact.body).toContain('dd.MM.yyyy');
    expect(stores.memory.list('demo', { kind: 'project_fact' })).toHaveLength(1);
  });

  test('parseReflection extracts a fenced JSON block and drops malformed entries', () => {
    const content = [
      'Here is what I learned:',
      '```json',
      JSON.stringify({
        skills: [
          { name: 'good', description: 'd', triggers: ['t'], body: 'b' },
          { description: 'no name — dropped', triggers: [], body: '' },
        ],
        facts: [{ title: 'Keep me', body: 'fact' }, { body: 'no title — dropped' }],
      }),
      '```',
    ].join('\n');

    const parsed = parseReflection(content);
    expect(parsed.skills.map((s) => s.name)).toEqual(['good']);
    expect(parsed.facts.map((f) => f.title)).toEqual(['Keep me']);
  });

  test('buildReflectPrompt grounds on the screen and notes and asks for JSON', () => {
    const messages = buildReflectPrompt({
      screen: 'wizard-step-2',
      notes: 'multi-step form with validation',
    });
    const all = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    expect(all).toContain('wizard-step-2');
    expect(all).toContain('multi-step form with validation');
    expect(all.toLowerCase()).toContain('json');
  });

  test('unparseable model output creates nothing and does not throw', async () => {
    const result = await reflect(stubGateway('I could not find anything reusable.'), stores, {
      project: 'demo',
      screen: 's',
      notes: 'n',
      model: 'gpt-x',
    });
    expect(result.skills).toEqual([]);
    expect(result.facts).toEqual([]);
    expect(stores.memory.list('demo')).toEqual([]);
  });
});
