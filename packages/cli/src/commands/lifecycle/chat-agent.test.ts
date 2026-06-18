import { describe, expect, test } from 'vitest';
import type { LlmGateway, LlmRequest, LlmResponse } from '@loom/agents';
import { MemoryStore, MIGRATIONS, openDb, runMigrations, SkillStore } from '@loom/core';
import { createPolicy } from '@loom/tools';
import { agenticChatTurn, packRecall } from './chat-agent.js';
import type { ChatTool } from './chat-tools.js';

/** A gateway scripted to return a fixed sequence of responses (one per turn). */
function scriptedGateway(script: LlmResponse[]): LlmGateway {
  let i = 0;
  return {
    complete(_req: LlmRequest): Promise<LlmResponse> {
      const r = script[Math.min(i, script.length - 1)]!;
      i += 1;
      return Promise.resolve(r);
    },
  };
}

const text = (content: string): LlmResponse => ({
  content,
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1 },
  finishReason: 'stop',
});
const callTool = (name: string, args: object): LlmResponse => ({
  content: null,
  toolCalls: [{ id: 'c1', name, arguments: JSON.stringify(args) }],
  usage: { inputTokens: 1, outputTokens: 1 },
  finishReason: 'tool_calls',
});

function fakeTool(name: string, risk: ChatTool['risk'], onRun: () => void): ChatTool {
  return {
    risk,
    def: {
      name,
      description: `the ${name} tool`,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        onRun();
        return `${name} done`;
      },
    },
  };
}

describe('agenticChatTurn', () => {
  test('runs a read tool the model calls (no prompt), then returns the final text', async () => {
    let ran = false;
    const gw = scriptedGateway([callTool('status', {}), text('All good — 0 screens.')]);
    const { finalText, history } = await agenticChatTurn(gw, {
      model: 'm',
      history: [],
      input: 'how are we?',
      tools: [
        fakeTool('status', 'read', () => {
          ran = true;
        }),
      ],
      policy: createPolicy('ask'),
      prompt: () => 'no', // a read tool must never prompt
    });
    expect(ran).toBe(true);
    expect(finalText).toBe('All good — 0 screens.');
    expect(history.some((m) => m.role === 'tool')).toBe(true);
  });

  test('a denied expensive tool is not executed; the model is told', async () => {
    let ran = false;
    let prompted = '';
    const gw = scriptedGateway([callTool('run', {}), text('OK, I will not run it.')]);
    const { finalText } = await agenticChatTurn(gw, {
      model: 'm',
      history: [],
      input: 'rebuild everything',
      tools: [
        fakeTool('run', 'expensive', () => {
          ran = true;
        }),
      ],
      policy: createPolicy('ask'),
      prompt: (req) => {
        prompted = req.name;
        return 'no';
      },
    });
    expect(prompted).toBe('run');
    expect(ran).toBe(false);
    expect(finalText).toContain('will not run');
  });

  test('allow-all runs an expensive tool without prompting', async () => {
    let ran = false;
    let prompts = 0;
    const gw = scriptedGateway([callTool('run', {}), text('Done.')]);
    await agenticChatTurn(gw, {
      model: 'm',
      history: [],
      input: 'go',
      tools: [
        fakeTool('run', 'expensive', () => {
          ran = true;
        }),
      ],
      policy: createPolicy('allow-all'),
      prompt: () => {
        prompts += 1;
        return 'no';
      },
    });
    expect(ran).toBe(true);
    expect(prompts).toBe(0);
  });
});

describe('packRecall', () => {
  test('recalls the relevant project facts + skills for the turn, excludes irrelevant ones', () => {
    const db = openDb(':memory:');
    runMigrations(db, MIGRATIONS);
    const mem = new MemoryStore(db);
    mem.remember({
      project: 'baa',
      kind: 'project_fact',
      title: 'Dates',
      body: 'all BAA dates render dd.MM.yyyy',
    });
    mem.remember({
      project: 'baa',
      kind: 'project_fact',
      title: 'Unrelated',
      body: 'the moon is far away',
    });
    new SkillStore(db).addSkill({
      project: 'baa',
      tier: 'project',
      status: 'active',
      name: 'JSTL date parity',
      description: 'convert fmt:formatDate to the same date format',
      triggers: ['date'],
    });

    const out = packRecall(db, 'baa', 'what date format do these dates use');
    expect(out).toContain('dd.MM.yyyy'); // the relevant fact is recalled
    expect(out).toContain('JSTL date parity'); // the relevant skill too
    expect(out).not.toContain('moon'); // the irrelevant fact is excluded
    expect(packRecall(db, 'baa', '')).toBe(''); // empty input → no recall block
    db.close();
  });
});
