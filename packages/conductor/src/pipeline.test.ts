import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAiDriver } from '@loom/agents';
import {
  EventLog,
  GateStore,
  MemoryStore,
  MIGRATIONS,
  openDb,
  QuestionStore,
  runMigrations,
  SkillStore,
  SpanStore,
  TaskStore,
} from '@loom/core';
import { MockLlmServer } from '@loom/test-kit';
import type { DomSnapshot } from '@loom/browser';
import { PNG } from 'pngjs';
import { afterEach, expect, test } from 'vitest';
import { copilotBuildStrategy, type BuildStrategy } from './builder.js';
import { runPipeline, type CaptureFn, type DomCaptureFn } from './pipeline.js';

/** A build seam that just writes a file and reports success — for multi-screen wiring tests. */
const passingBuild: BuildStrategy = async ({ bRepoDir }) => {
  writeFileSync(join(bRepoDir, 'index.html'), '<h1>x</h1>');
  return {
    status: 'completed',
    filesWritten: ['index.html'],
    usage: { inputTokens: 1, outputTokens: 1 },
  };
};

const STRUTS_CONFIG = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'legacy-webapp',
  'legacy-src',
  'WEB-INF',
  'struts-config.xml',
);

const mocks: MockLlmServer[] = [];
afterEach(async () => {
  while (mocks.length) await mocks.pop()!.stop();
});

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'pipeline-'));
}

function harnessDb() {
  const db = openDb(join(tmp(), 'harness.db'));
  runMigrations(db, MIGRATIONS);
  return db;
}

async function mockGateway(): Promise<{ gateway: OpenAiDriver; mock: MockLlmServer }> {
  const mock = new MockLlmServer();
  mocks.push(mock);
  const { baseUrl } = await mock.start();
  return { gateway: new OpenAiDriver({ baseUrl, apiKey: 'test' }), mock };
}

/** A solid-colour PNG so the evaluator's diff has real images to compare. */
function solidPng(rgb: [number, number, number]): Buffer {
  const p = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < 4 * 4; i++) {
    const o = i * 4;
    p.data[o] = rgb[0];
    p.data[o + 1] = rgb[1];
    p.data[o + 2] = rgb[2];
    p.data[o + 3] = 255;
  }
  return PNG.sync.write(p);
}

/** Capture seam that returns one image for the legacy app and another for the rebuild. */
function fakeCapture(legacyPng: Buffer, rebuiltPng: Buffer): CaptureFn {
  return ({ url }) => Promise.resolve(url.includes('legacy.test') ? legacyPng : rebuiltPng);
}

/** A small DOM both sides share, so the structural gate passes by default. */
const matchingDom: DomSnapshot = {
  tag: 'body',
  attrs: {},
  children: [
    {
      tag: 'form',
      attrs: { action: '/login' },
      children: [
        { tag: 'input', attrs: { name: 'username', type: 'text' }, children: [] },
        { tag: 'input', attrs: { name: 'password', type: 'password' }, children: [] },
      ],
    },
  ],
};

function fakeDomCapture(legacy: DomSnapshot, rebuilt: DomSnapshot): DomCaptureFn {
  return ({ url }) => Promise.resolve(url.includes('legacy.test') ? legacy : rebuilt);
}

test('runPipeline maps, builds, evaluates and passes the login screen', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueToolCall('write_file', { path: 'index.html', content: '<h1>Login</h1>' });
  mock.enqueueToolCall('write_file', { path: 'style.css', content: 'body{}' });
  mock.enqueueText('Done.');
  const same = solidPng([240, 240, 240]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.screens).toHaveLength(1);
  expect(result.screens[0].screenKey).toBe('login');
  expect(result.screens[0].state).toBe('passed');
  expect(result.passed).toBe(1);
  expect(result.failed).toBe(0);
  expect(result.coverage.coveragePct).toBe(100);
  expect(result.coverage.complete).toBe(true);

  const store = new TaskStore(db);
  const run = store.getRun(result.runId);
  expect(run?.status).toBe('completed');
  const wps = store.listWorkPackages(result.runId);
  expect(wps).toHaveLength(1);
  expect(wps[0].state).toBe('passed');
  expect(store.listAttempts(wps[0].id).length).toBeGreaterThanOrEqual(1);
  const best = store.bestEval(wps[0].id);
  expect(best?.passed).toBe(true);
  expect(best?.visualPct).toBe(0);
});

test('builds independent screens concurrently when maxParallel > 1', async () => {
  const db = harnessDb();
  const { gateway } = await mockGateway();
  const same = solidPng([240, 240, 240]);

  let inFlight = 0;
  let peak = 0;
  const concurrentBuild: BuildStrategy = async ({ bRepoDir }) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 15));
    writeFileSync(join(bRepoDir, 'index.html'), '<h1>x</h1>');
    inFlight -= 1;
    return {
      status: 'completed',
      filesWritten: ['index.html'],
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  };

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login', 'list', 'wizard'],
    maxParallel: 3,
    build: concurrentBuild,
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(peak).toBeGreaterThan(1); // genuinely concurrent, not serial
  expect(result.passed).toBe(3);
  expect(result.screens.map((s) => s.state)).toEqual(['passed', 'passed', 'passed']);
});

test('reflectOnPass drafts a skill from a passed screen (best-effort, scoped)', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  // Builder responses, then the Reflector's extraction reply (FIFO).
  mock.enqueueToolCall('write_file', { path: 'index.html', content: '<h1>Login</h1>' });
  mock.enqueueText('Done.');
  mock.enqueueText(
    JSON.stringify({
      skills: [
        {
          name: 'login-form-parity',
          description: 'reproduce the legacy login form',
          triggers: ['login', 'password'],
          body: 'Keep the password field type=password.',
        },
      ],
      facts: [{ title: 'Auth path', body: 'login posts to the auth action' }],
    }),
  );
  const same = solidPng([240, 240, 240]);
  const skillsOut = tmp();

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    reflectOnPass: true,
    skillsDir: skillsOut,
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.screens[0].state).toBe('passed');
  // The Reflector drafted a (scoped, draft, inactive) skill from the passed screen.
  const skills = new SkillStore(db);
  const drafted = skills.recall('fixture', { terms: ['login'], status: 'draft' });
  expect(drafted.map((s) => s.name)).toContain('login-form-parity');

  // …and opened a skill gate so a human can approve it (never auto-activated).
  const gates = new GateStore(db).list({ status: 'open', type: 'skill' });
  expect(gates.length).toBeGreaterThanOrEqual(1);
  expect(gates.some((g) => (g.payload as { name?: string }).name === 'login-form-parity')).toBe(
    true,
  );

  // …and persisted the draft as a SKILL.md file under skillsDir.
  expect(existsSync(join(skillsOut, 'login-form-parity', 'SKILL.md'))).toBe(true);
});

test('records skill use on a passed screen and auto-promotes a proven generated skill', async () => {
  const db = harnessDb();
  const { gateway } = await mockGateway();
  // An already-approved (active) generated skill matching the login screen's recall terms.
  const skills = new SkillStore(db);
  const skill = skills.addSkill({
    name: 'session-auth-form',
    description: 'reproduce the legacy login form and session cookie',
    triggers: ['login', 'password'],
    body: 'Keep the password field type=password.',
    tier: 'generated',
    project: 'fixture',
    status: 'active',
  });
  const same = solidPng([240, 240, 240]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    build: passingBuild,
    skillPromoteAfter: 1, // a single proven reuse graduates it to the bundled tier
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.passed).toBe(1);
  // The recalled skill's use was recorded as a success…
  const got = skills.get(skill.id)!;
  expect(got.useCount).toBe(1);
  expect(got.successCount).toBe(1);
  // …and crossing the threshold auto-promoted it to the bundled (global) tier.
  expect(got.tier).toBe('bundled');
  expect(got.project).toBeNull();
  // …with a telemetry event Mission Control (and a human) can see.
  const types = new EventLog(db).tailFrom(0, 1000, { runId: result.runId }).map((e) => e.type);
  expect(types).toContain('skill.promoted');
});

test('records a recalled skill as a non-success when its screen blocks', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueText('Done.', { repeat: true });
  const skills = new SkillStore(db);
  const skill = skills.addSkill({
    name: 'session-auth-form',
    description: 'reproduce the legacy login form',
    triggers: ['login', 'password'],
    body: 'x',
    tier: 'bundled',
    status: 'active',
  });

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    maxAttempts: 1,
    capture: fakeCapture(solidPng([0, 0, 0]), solidPng([255, 255, 255])), // never matches → blocks
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.screens[0].state).toBe('blocked');
  const got = skills.get(skill.id)!;
  expect(got.useCount).toBe(1); // the use is still recorded…
  expect(got.successCount).toBe(0); // …but as a non-success, so it never falsely promotes
});

test('records an OTel LLM span per build attempt (the cost / Live-Now spine)', async () => {
  const db = harnessDb();
  const { gateway } = await mockGateway();
  const same = solidPng([240, 240, 240]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    build: passingBuild,
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.passed).toBe(1);
  const spanStore = new SpanStore(db);
  const llm = spanStore.listForRun(result.runId).filter((s) => s.kind === 'llm');
  expect(llm.length).toBeGreaterThanOrEqual(1);
  expect((llm[0]!.attributes as Record<string, unknown>)['gen_ai.request.model']).toBe('mock');
  const agg = spanStore.aggregate(result.runId);
  expect(agg.inputTokens).toBeGreaterThanOrEqual(1);
  expect(agg.outputTokens).toBeGreaterThanOrEqual(1);
});

test('consolidates duplicate project facts at run finish (memory stays bounded)', async () => {
  const db = harnessDb();
  const { gateway } = await mockGateway();
  // Two project facts the Reflector "re-discovered" across shifts — same body, different titles.
  const memory = new MemoryStore(db);
  memory.remember({
    project: 'fixture',
    kind: 'project_fact',
    title: 'Dates',
    body: 'dates render dd.MM.yyyy',
  });
  memory.remember({
    project: 'fixture',
    kind: 'project_fact',
    title: 'Dates again',
    body: 'Dates render DD.MM.yyyy',
  });
  const same = solidPng([240, 240, 240]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    build: passingBuild,
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.passed).toBe(1);
  // The duplicate fact was consolidated away (one survives), and the distinct ones are untouched.
  expect(memory.list('fixture', { kind: 'project_fact' })).toHaveLength(1);
  const types = new EventLog(db).tailFrom(0, 1000, { runId: result.runId }).map((e) => e.type);
  expect(types).toContain('memory.consolidated');
});

test('writes a worklog memory when an attempt fails — recalled on retry/resume', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueText('Done.', { repeat: true });

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    maxAttempts: 1,
    capture: fakeCapture(solidPng([0, 0, 0]), solidPng([255, 255, 255])), // visual never matches
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.screens[0].state).toBe('blocked');
  const wpId = new TaskStore(db).listWorkPackages(result.runId)[0].id;
  const worklog = new MemoryStore(db).list('fixture', { kind: 'worklog', scopeId: wpId });
  expect(worklog.length).toBeGreaterThanOrEqual(1);
  expect(worklog[0].body).toMatch(/diff/i); // captures what failed, for the Fixer to avoid repeating
});

test('builds via the Copilot agent strategy (stubbed copilot, no key) → passed', async () => {
  const db = harnessDb();
  const { gateway } = await mockGateway(); // unused by the copilot strategy, but required by the API
  // A stub agentic copilot: writes the rebuild into its cwd (the b-repo) + reports usage.
  const stub = join(tmp(), 'copilot-stub.js');
  writeFileSync(
    stub,
    `require('fs').writeFileSync('index.html', '<h1>Login</h1>');\n` +
      `process.stdout.write(JSON.stringify({ text: 'built', usage: { input_tokens: 20, output_tokens: 8 } }));\n`,
  );
  const same = solidPng([240, 240, 240]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'gpt-5.4',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
    build: copilotBuildStrategy({ bin: [process.execPath, stub] }),
  });

  expect(result.screens[0].state).toBe('passed');
  const store = new TaskStore(db);
  const attempt = store.listAttempts(store.listWorkPackages(result.runId)[0].id)[0]!;
  expect(attempt.outputTokens).toBe(8); // usage flowed from the copilot agent
});

test('the builder receives a work order carrying the legacy JSP source + forms', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueToolCall('write_file', { path: 'index.html', content: '<h1>Login</h1>' });
  mock.enqueueText('Done.');
  const same = solidPng([240, 240, 240]);

  await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  const builderReq = mock.requests.find((r) =>
    JSON.stringify(r.body.messages).includes('Work order'),
  );
  const text = JSON.stringify(builderReq!.body.messages);
  expect(text).toContain('com.example.legacy.web.action.LoginAction'); // recovered action class
  expect(text).toContain('username'); // parsed form field
  expect(text).toContain('html:text'); // embedded real JSP source
});

test('the structural gate fails a pixel-perfect rebuild that drops a dropdown option', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueText('Done.', { repeat: true });
  const same = solidPng([240, 240, 240]); // identical screenshots → visual passes
  const legacyDom: DomSnapshot = {
    tag: 'body',
    attrs: {},
    children: [
      {
        tag: 'select',
        attrs: { name: 'region' },
        options: ['', 'EMEA', 'APAC', 'AMER'],
        children: [],
      },
    ],
  };
  const rebuiltDom: DomSnapshot = {
    tag: 'body',
    attrs: {},
    children: [
      { tag: 'select', attrs: { name: 'region' }, options: ['', 'EMEA', 'APAC'], children: [] }, // missing AMER
    ],
  };

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    maxAttempts: 1,
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(legacyDom, rebuiltDom),
  });

  // Pixel-identical (visual diff 0%) but the missing option blocks it — exactly
  // the kind of small thing the structural layer exists to catch.
  expect(result.screens[0].state).toBe('blocked');
  const store = new TaskStore(db);
  const best = store.bestEval(store.listWorkPackages(result.runId)[0].id);
  expect(best?.passed).toBe(false);
  expect(best?.visualPct).toBe(0);
});

test('the computed-style gate fails a rebuild with sub-threshold font drift', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueText('Done.', { repeat: true });
  const same = solidPng([240, 240, 240]); // identical screenshots → visual passes
  const withFont = (size: string): DomSnapshot => ({
    tag: 'body',
    attrs: {},
    styles: {},
    children: [{ tag: 'p', attrs: {}, styles: { 'font-size': size }, children: [] }],
  });

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    maxAttempts: 1,
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(withFont('11px'), withFont('13px')), // structurally identical, font drifts
  });

  expect(result.screens[0].state).toBe('blocked');
  const store = new TaskStore(db);
  expect(store.bestEval(store.listWorkPackages(result.runId)[0].id)?.passed).toBe(false);
});

test('runPipeline blocks a screen whose rebuild never reaches parity', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueText('Done.', { repeat: true });

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    maxAttempts: 2,
    capture: fakeCapture(solidPng([0, 0, 0]), solidPng([255, 255, 255])),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.screens[0].state).toBe('blocked');
  expect(result.failed).toBe(1);
  expect(result.coverage.coveragePct).toBe(0);
  expect(result.coverage.notBuilt).toEqual(['login']);

  const store = new TaskStore(db);
  expect(store.getRun(result.runId)?.status).toBe('failed');
  const wp = store.listWorkPackages(result.runId)[0];
  expect(store.listAttempts(wp.id)).toHaveLength(2);

  // a blocked screen escalates to the questions inbox for a human to unblock
  const questions = new QuestionStore(db).list({ status: 'open', wpId: wp.id });
  expect(questions.length).toBeGreaterThanOrEqual(1);
  expect(questions[0].question).toMatch(/parity|proceed/i);
});

test('shift stop-the-line halts the run after consecutive failures', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueText('done', { repeat: true });

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login', 'list'],
    maxAttempts: 1,
    capture: fakeCapture(solidPng([0, 0, 0]), solidPng([255, 255, 255])), // visual always fails
    domCapture: fakeDomCapture(matchingDom, matchingDom),
    shift: { stopAfterConsecutiveFailures: 1 },
  });

  expect(result.stopReason).toBe('stop_the_line');
  const store = new TaskStore(db);
  expect(store.getRun(result.runId)?.status).toBe('stopped');
  // the second screen was never touched — the run stopped instead of thrashing
  const list = store.listWorkPackages(result.runId).find((w) => w.screenKey === 'list')!;
  expect(['pending', 'planned']).toContain(list.state);
});

test('pings the webhook on a stop-the-line shift stop (env-gated, best-effort)', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueText('done', { repeat: true });

  // A tiny capture server stands in for a Teams/Slack incoming webhook.
  const received: Array<{ kind?: string; text?: string }> = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(JSON.parse(body || '{}'));
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const webhookUrl = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/hook`;

  try {
    const result = await runPipeline({
      db,
      gateway,
      model: 'mock',
      project: 'fixture',
      strutsConfigPath: STRUTS_CONFIG,
      atlasPath: join(tmp(), 'codeatlas.db'),
      legacyBaseUrl: 'http://legacy.test/',
      bRepoRoot: tmp(),
      screens: ['login', 'list'],
      maxAttempts: 1,
      capture: fakeCapture(solidPng([0, 0, 0]), solidPng([255, 255, 255])), // always fails
      domCapture: fakeDomCapture(matchingDom, matchingDom),
      shift: { stopAfterConsecutiveFailures: 1 },
      webhookUrl,
    });
    expect(result.stopReason).toBe('stop_the_line');
    expect(received.some((p) => p.kind === 'shift_stopped')).toBe(true);
    expect(received.find((p) => p.kind === 'shift_stopped')!.text).toMatch(/stop_the_line/);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
});

test('shift token budget stops the run before the next screen', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueText('done', { repeat: true });
  const same = solidPng([240, 240, 240]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login', 'list'],
    maxAttempts: 1,
    capture: fakeCapture(same, same), // visual passes
    domCapture: fakeDomCapture(matchingDom, matchingDom),
    shift: { maxTokens: 1 }, // the first screen's spend trips the budget before the second
  });

  expect(result.stopReason).toBe('budget_tokens');
  const store = new TaskStore(db);
  const wps = store.listWorkPackages(result.runId);
  expect(wps.find((w) => w.screenKey === 'login')!.state).toBe('passed');
  expect(['pending', 'planned']).toContain(wps.find((w) => w.screenKey === 'list')!.state);
});

test('runPipeline records MAP and eval events on the event log', async () => {
  const db = harnessDb();
  const { gateway, mock } = await mockGateway();
  mock.enqueueToolCall('write_file', { path: 'index.html', content: 'x' });
  mock.enqueueText('Done.');
  const same = solidPng([10, 20, 30]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  const events = new EventLog(db).tailFrom(0, 1000, { runId: result.runId });
  const types = events.map((e) => e.type);
  expect(types).toContain('map.completed');
  expect(types).toContain('eval.scored');
  expect(types).toContain('heartbeat'); // a per-screen heartbeat lands for watchers
});

test('a passed screen opens a ship gate for human approval', async () => {
  const db = harnessDb();
  const { gateway } = await mockGateway();
  const same = solidPng([240, 240, 240]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    build: passingBuild,
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.passed).toBe(1);
  const shipGates = new GateStore(db).list({ status: 'open', type: 'ship' });
  expect(shipGates).toHaveLength(1);
  expect((shipGates[0]!.payload as { screenKey?: string }).screenKey).toBe('login');
});

test('runs the cross-screen integration eval once ≥2 screens pass', async () => {
  const db = harnessDb();
  const { gateway } = await mockGateway();
  const same = solidPng([240, 240, 240]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login', 'list'],
    build: passingBuild,
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.passed).toBe(2);
  const types = new EventLog(db).tailFrom(0, 1000, { runId: result.runId }).map((e) => e.type);
  expect(types).toContain('integration.passed'); // both still match their baselines → no regression
});

test('runPipeline resumes a crashed run: interrupted attempt reconciled, WP finished', async () => {
  const db = harnessDb();
  const store = new TaskStore(db);
  // Arrange a run that died mid-build: a WP stuck 'building' with a 'running' attempt.
  const run = store.createRun({ project: 'fixture' });
  const wp = store.createWorkPackage({
    runId: run.id,
    title: 'Rebuild login',
    screenKey: 'login',
    spec: { key: 'login' },
  });
  store.setWorkPackageState(wp.id, 'building');
  const deadAttempt = store.createAttempt({ wpId: wp.id, role: 'builder', pid: 99999 });
  expect(store.getAttempt(deadAttempt.id)?.status).toBe('running');

  const { gateway, mock } = await mockGateway();
  mock.enqueueToolCall('write_file', { path: 'index.html', content: '<h1>Login</h1>' });
  mock.enqueueText('Done.');
  const same = solidPng([200, 200, 200]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    runId: run.id,
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.runId).toBe(run.id);
  expect(store.getAttempt(deadAttempt.id)?.status).toBe('interrupted');
  expect(store.getWorkPackage(wp.id)?.state).toBe('passed');
});

test('a parallel run resumes cleanly after a mid-flight crash (chaos)', async () => {
  const db = harnessDb();
  const store = new TaskStore(db);
  // A run that died mid-shift: two screens stuck 'building' with dead 'running'
  // attempts; a third screen never got a WP (PLAN will create it on resume).
  const run = store.createRun({ project: 'fixture' });
  for (const key of ['login', 'list']) {
    const wp = store.createWorkPackage({
      runId: run.id,
      title: `Rebuild ${key}`,
      screenKey: key,
      spec: { key },
    });
    store.setWorkPackageState(wp.id, 'building');
    store.createAttempt({ wpId: wp.id, role: 'builder', pid: 99999 }); // running → dead process
  }

  const { gateway } = await mockGateway();
  const same = solidPng([200, 200, 200]);

  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login', 'list', 'wizard'],
    runId: run.id,
    maxParallel: 3,
    build: passingBuild,
    capture: fakeCapture(same, same),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  // Every dead attempt reconciled, every screen finished — concurrently, on resume.
  expect(result.runId).toBe(run.id);
  expect(result.passed).toBe(3);
  expect(result.screens.map((s) => s.state)).toEqual(['passed', 'passed', 'passed']);
  const attempts = store.listWorkPackages(run.id).flatMap((w) => store.listAttempts(w.id));
  expect(attempts.some((a) => a.status === 'interrupted')).toBe(true);
});

test('a per-WP token budget stops a screen before maxAttempts', async () => {
  const db = harnessDb();
  const { gateway } = await mockGateway();
  const burnBuild: BuildStrategy = async ({ bRepoDir }) => {
    writeFileSync(join(bRepoDir, 'index.html'), '<h1>x</h1>');
    return {
      status: 'completed',
      filesWritten: ['index.html'],
      usage: { inputTokens: 100, outputTokens: 100 },
    };
  };
  // Legacy ≠ rebuilt → the visual gate never passes, so the FIX loop would run
  // every attempt — except the per-WP token budget cuts it short.
  const result = await runPipeline({
    db,
    gateway,
    model: 'mock',
    project: 'fixture',
    strutsConfigPath: STRUTS_CONFIG,
    atlasPath: join(tmp(), 'codeatlas.db'),
    legacyBaseUrl: 'http://legacy.test/',
    bRepoRoot: tmp(),
    screens: ['login'],
    maxAttempts: 10,
    shift: { maxTokensPerWp: 250 },
    build: burnBuild,
    capture: fakeCapture(solidPng([0, 0, 0]), solidPng([255, 255, 255])),
    domCapture: fakeDomCapture(matchingDom, matchingDom),
  });

  expect(result.screens[0].state).toBe('blocked');
  const store = new TaskStore(db);
  const wpId = store.listWorkPackages(result.runId)[0].id;
  // 200 tokens/attempt, budget 250: attempts 1 and 2 run (0→200→400), attempt 3
  // is refused (400 ≥ 250). So 2 attempts, not 10.
  expect(store.listAttempts(wpId).length).toBe(2);
});
