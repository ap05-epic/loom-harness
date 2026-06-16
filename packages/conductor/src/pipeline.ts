import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reflect, type GuardConfig, type LlmGateway } from '@loom/agents';
import {
  BrowserSession,
  captureDom as captureDomStandalone,
  DEFAULT_VIEWPORT,
  type DomSnapshot,
  type Viewport,
} from '@loom/browser';
import {
  discoverLegacyWebapp,
  ingestLegacyWebapp,
  openCodeAtlas,
  parseJsp,
  parseStrutsConfig,
  parseTilesDefs,
  parseWebXml,
  repoMap,
  type CodeAtlas,
  type Screen,
} from '@loom/cartographer';
import {
  DEFAULT_PROMOTE_AFTER,
  EventLog,
  exportSpansOtlp,
  GateStore,
  MemoryStore,
  notifyWebhook,
  QuestionStore,
  SkillStore,
  SpanStore,
  TaskStore,
  type SqliteDatabase,
  type WpState,
} from '@loom/core';
import {
  coverageLedger,
  DEFAULT_STYLE_PROPS,
  type CoverageReport,
  type DomFinding,
  type StyleFinding,
} from '@loom/evaluator';
import { writeSkillFile } from '@loom/skills';
import { defaultBuildStrategy, type BuildStrategy } from './builder.js';
import { buildWorkOrder } from './work-order.js';
import { evaluateScreen } from './eval-screen.js';
import { integrationEval } from './integration-eval.js';
import { emitHeartbeat } from './heartbeat.js';

/** The screenshot seam — real browser by default, faked in tests. */
export type CaptureFn = (input: { url: string; viewport: Viewport }) => Promise<Buffer>;

/** The DOM-snapshot seam (for the structural eval) — real browser by default, faked in tests. */
export type DomCaptureFn = (input: { url: string; viewport: Viewport }) => Promise<DomSnapshot>;

export type RunPipelineOptions = {
  /** Migrated harness.db (the conductor is its single writer). */
  db: SqliteDatabase;
  gateway: LlmGateway;
  model: string;
  project: string;
  /** Legacy struts-config.xml to MAP. */
  strutsConfigPath: string;
  /** Where the CodeAtlas SQLite file lives (reused on resume). */
  atlasPath: string;
  /** Base URL of the running legacy app (the "A" baseline). */
  legacyBaseUrl: string;
  /** Root the Builder writes rebuilds under (one subdir per screen). */
  bRepoRoot: string;
  /** Screen keys to build; default = every screen the MAP found. */
  screens?: string[];
  /** Max acceptable visual diff %% (default 1). */
  threshold?: number;
  viewport?: Viewport;
  /** Build attempts before a screen is marked blocked (default 3). */
  maxAttempts?: number;
  /** Resume an existing run instead of creating one. */
  runId?: string;
  harnessVersion?: string;
  /** Where baseline screenshots are stored (default `<bRepoRoot>/.baseline`). */
  baselineDir?: string;
  /** Run-level safeguards for unattended (shift) runs — stop cleanly, never thrash. */
  shift?: ShiftLimits;
  /** Max independent screens to build concurrently (default 1 = serial). */
  maxParallel?: number;
  /** After a screen passes, run the Reflector to draft reusable skills + facts (best-effort). */
  reflectOnPass?: boolean;
  /** If set, persist each drafted skill as a SKILL.md file under this directory. */
  skillsDir?: string;
  /**
   * Successful reuses an *active*, *generated* skill needs before it auto-promotes to the
   * bundled (global) tier (default {@link DEFAULT_PROMOTE_AFTER}). The human approval gate
   * still runs first — this only graduates an already-proven skill.
   */
  skillPromoteAfter?: number;
  /** OTLP/HTTP collector base URL (`OTEL_EXPORTER_OTLP_ENDPOINT`). When set, the run's spans
   * are exported at finish (best-effort — a failure never affects the run). */
  otlpEndpoint?: string;
  /** Generic webhook URL (`LOOM_WEBHOOK_URL`). When set, stop-the-line and shift-done pings are
   * POSTed (Teams/Slack-compatible). Best-effort — a failure never affects the run. */
  webhookUrl?: string;
  // ---- seams (injected in tests) ----
  capture?: CaptureFn;
  domCapture?: DomCaptureFn;
  /** How a screen is built (default: our agent loop; copilot uses its own agent). */
  build?: BuildStrategy;
  screenUrl?: (screen: Screen, legacyBaseUrl: string) => string;
  buildGuards?: Partial<GuardConfig>;
  /** Cooperative cancel — `loom stop` flips this; the run halts at the next safe checkpoint. */
  shouldStop?: () => boolean;
  now?: () => number;
};

/** Hard, run-level limits for an unattended shift — any trip stops the run gracefully. */
export type ShiftLimits = {
  /** Cumulative input+output token budget across the run. */
  maxTokens?: number;
  /** Wall-clock cap for the whole run. */
  maxWallClockMs?: number;
  /** Stop-the-line: halt after this many consecutive screens fail to build. */
  stopAfterConsecutiveFailures?: number;
  /** Per-work-package token budget — stop a screen's FIX loop once it's spent. */
  maxTokensPerWp?: number;
};

export type StopReason = 'budget_tokens' | 'wall_clock' | 'stop_the_line' | 'stop_requested';

export type ScreenOutcome = {
  screenKey: string;
  wpId: string;
  state: WpState;
  diffPercent: number | null;
  attempts: number;
};

export type RunPipelineResult = {
  runId: string;
  screens: ScreenOutcome[];
  passed: number;
  failed: number;
  /** "No screen left behind" — how much of the targeted scope is built. */
  coverage: CoverageReport;
  /** Set when a shift safeguard stopped the run before the scope was finished. */
  stopReason: StopReason | null;
};

const DONE_STATES: WpState[] = ['passed', 'shipped'];
const HALTED_STATES: WpState[] = ['blocked', 'failed', 'needs_human'];

/** A WP we should (re)process this run — not already done and not awaiting a human. */
function shouldProcess(state: WpState): boolean {
  return !DONE_STATES.includes(state) && !HALTED_STATES.includes(state);
}

const defaultCapture: CaptureFn = async ({ url, viewport }) => {
  const session = new BrowserSession();
  await session.open();
  try {
    return await session.capture({ url, viewport });
  } finally {
    await session.close();
  }
};

const defaultDomCapture: DomCaptureFn = ({ url, viewport }) =>
  captureDomStandalone({ url, viewport, styleProps: DEFAULT_STYLE_PROPS });

function defaultScreenUrl(screen: Screen, legacyBaseUrl: string): string {
  return new URL(screen.actionPath.replace(/^\/+/, ''), legacyBaseUrl).toString();
}

/**
 * Idempotent MAP: build the enriched atlas (Struts + Tiles + web.xml + JSPs)
 * once and reuse it on resume. Returns the atlas plus a logical-path → file map
 * so the Builder's work order can embed the real legacy JSP source.
 */
function mapOnce(
  strutsConfigPath: string,
  atlasPath: string,
): { atlas: CodeAtlas; jspFiles: Map<string, string> } {
  const atlas = openCodeAtlas(atlasPath);
  const discovered = discoverLegacyWebapp(strutsConfigPath);
  const jspFiles = new Map(discovered.jsps.map((j) => [j.path, j.file]));
  if (atlas.screens().length === 0) {
    ingestLegacyWebapp(atlas, {
      struts: parseStrutsConfig(readFileSync(strutsConfigPath, 'utf8')),
      tiles: discovered.tilesDefsPath
        ? parseTilesDefs(readFileSync(discovered.tilesDefsPath, 'utf8'))
        : undefined,
      web: discovered.webXmlPath
        ? parseWebXml(readFileSync(discovered.webXmlPath, 'utf8'))
        : undefined,
      jsps: discovered.jsps.map((j) => ({
        path: j.path,
        info: parseJsp(readFileSync(j.file, 'utf8')),
      })),
    });
  }
  return { atlas, jspFiles };
}

function fixFeedback(
  diffPercent: number,
  findings: DomFinding[],
  styleFindings: StyleFinding[],
): string {
  const lines = ['', '', '## Prior attempt feedback'];
  lines.push(`Visual parity diff was ${diffPercent.toFixed(2)}%.`);
  if (findings.length) {
    lines.push('', 'Structural differences vs the legacy DOM (fix every one):');
    for (const f of findings.slice(0, 25)) lines.push(`- [${f.code}] ${f.path} — ${f.detail}`);
  }
  if (styleFindings.length) {
    lines.push('', 'Computed-style differences vs the legacy DOM (fix every one):');
    for (const f of styleFindings.slice(0, 25)) lines.push(`- ${f.path} — ${f.detail}`);
  }
  lines.push('', 'Rewrite the files to match the legacy screen exactly.');
  return lines.join('\n');
}

/**
 * The conductor's outer loop for one run: MAP → CRAWL (baseline) → PLAN → per
 * screen BUILD → EVAL → FIX, persisting every transition to the TaskStore and
 * EventLog. Resumable: call again with the same `runId` after a crash and it
 * reconciles interrupted attempts and finishes the unfinished work packages.
 */
export async function runPipeline(options: RunPipelineOptions): Promise<RunPipelineResult> {
  const store = new TaskStore(options.db);
  const events = new EventLog(options.db);
  const skills = new SkillStore(options.db);
  const memory = new MemoryStore(options.db);
  const gates = new GateStore(options.db);
  const questions = new QuestionStore(options.db);
  const spans = new SpanStore(options.db);
  const capture = options.capture ?? defaultCapture;
  const domCapture = options.domCapture ?? defaultDomCapture;
  const build = options.build ?? defaultBuildStrategy;
  const screenUrl = options.screenUrl ?? defaultScreenUrl;
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const threshold = options.threshold ?? 1;
  const maxAttempts = options.maxAttempts ?? 3;
  const baselineDir = options.baselineDir ?? join(options.bRepoRoot, '.baseline');

  // Crash-safety: any attempt still 'running' belongs to a dead process.
  store.reconcileInterrupted();

  const run =
    (options.runId ? store.getRun(options.runId) : null) ??
    store.createRun({ project: options.project, harnessVersion: options.harnessVersion });

  // Out-of-band "ping a human" notifier (Teams/Slack-compatible). Env-gated + best-effort —
  // a down webhook must never affect the run. Used for stop-the-line and shift-done.
  const notify = async (kind: string, text: string): Promise<void> => {
    if (!options.webhookUrl) return;
    try {
      await notifyWebhook({ url: options.webhookUrl, event: { kind, text, runId: run.id } });
    } catch {
      /* best-effort */
    }
  };

  // ---- MAP ----
  store.setRunStage(run.id, 'map');
  const { atlas, jspFiles } = mapOnce(options.strutsConfigPath, options.atlasPath);
  const repoMapText = repoMap(atlas, { project: options.project });
  const jspSource = (logicalPath: string): string | undefined => {
    const file = jspFiles.get(logicalPath);
    return file ? readFileSync(file, 'utf8') : undefined;
  };
  try {
    const allScreens = atlas.screens();
    const wanted = new Set(options.screens ?? allScreens.map((s) => s.key));
    const targets = allScreens.filter((s) => wanted.has(s.key));
    events.append({
      type: 'map.completed',
      runId: run.id,
      payload: { screens: allScreens.map((s) => s.key), targets: targets.map((s) => s.key) },
    });

    // ---- PLAN (idempotent: one WP per screen, reused on resume) ----
    store.setRunStage(run.id, 'plan');
    const byScreen = new Map(store.listWorkPackages(run.id).map((w) => [w.screenKey, w]));
    for (const screen of targets) {
      if (byScreen.has(screen.key)) continue;
      const wp = store.createWorkPackage({
        runId: run.id,
        title: `Rebuild ${screen.key}`,
        screenKey: screen.key,
        spec: screen,
      });
      store.setWorkPackageState(wp.id, 'planned');
      byScreen.set(screen.key, store.getWorkPackage(wp.id)!);
      events.append({
        type: 'wp.created',
        runId: run.id,
        wpId: wp.id,
        payload: { screenKey: screen.key, title: wp.title },
      });
    }

    // ---- CRAWL (capture the legacy baseline once per screen) ----
    store.setRunStage(run.id, 'crawl');
    mkdirSync(baselineDir, { recursive: true });
    for (const screen of targets) {
      const wp = byScreen.get(screen.key)!;
      if (!shouldProcess(wp.state)) continue;
      const baselinePath = join(baselineDir, `${screen.key}.png`);
      if (existsSync(baselinePath)) continue;
      const url = screenUrl(screen, options.legacyBaseUrl);
      const png = await capture({ url, viewport });
      writeFileSync(baselinePath, png);
      events.append({
        type: 'crawl.captured',
        runId: run.id,
        wpId: wp.id,
        payload: { screenKey: screen.key, url },
      });
    }

    // ---- BUILD → EVAL → FIX (with shift safeguards) ----
    store.setRunStage(run.id, 'build');
    const clock = options.now ?? Date.now;
    const shiftStart = clock();
    const maxParallel = Math.max(1, options.maxParallel ?? 1);
    let cumulativeTokens = 0;
    let consecutiveFailures = 0;
    let stopReason: StopReason | null = null;

    // A bounded worker pool over the unfinished screens. maxParallel=1 is the
    // serial path (unchanged); >1 builds independent screens concurrently. Shift
    // guards are checked before each dispatch — once any trips, in-flight screens
    // finish but no new one starts, so the run stops gracefully, never thrashing.
    const buildQueue = targets.filter((s) => shouldProcess(byScreen.get(s.key)!.state));
    let cursor = 0;
    const shiftTripped = (): StopReason | null => {
      // Cooperative stop (`loom stop`) — honored even when no shift limits are set.
      if (options.shouldStop?.()) return 'stop_requested';
      const shift = options.shift;
      if (!shift) return null;
      if (shift.maxWallClockMs !== undefined && clock() - shiftStart > shift.maxWallClockMs) {
        return 'wall_clock';
      }
      if (shift.maxTokens !== undefined && cumulativeTokens >= shift.maxTokens) {
        return 'budget_tokens';
      }
      if (
        shift.stopAfterConsecutiveFailures !== undefined &&
        consecutiveFailures >= shift.stopAfterConsecutiveFailures
      ) {
        return 'stop_the_line';
      }
      return null;
    };
    const buildWorker = async (): Promise<void> => {
      for (;;) {
        if (stopReason) return;
        const tripped = shiftTripped();
        if (tripped) {
          stopReason = tripped;
          return;
        }
        const i = cursor;
        cursor += 1;
        if (i >= buildQueue.length) return;
        const screen = buildQueue[i]!;
        const wp = byScreen.get(screen.key)!;
        const outcome = await processWorkPackage({
          store,
          events,
          runId: run.id,
          atlas,
          screen,
          wpId: wp.id,
          baseline: readFileSync(join(baselineDir, `${screen.key}.png`)),
          bRepoDir: join(options.bRepoRoot, screen.key),
          legacyUrl: screenUrl(screen, options.legacyBaseUrl),
          jspSource,
          repoMapText,
          skills,
          memory,
          gates,
          questions,
          spans,
          project: options.project,
          reflectOnPass: options.reflectOnPass ?? false,
          skillsDir: options.skillsDir,
          skillPromoteAfter: options.skillPromoteAfter ?? DEFAULT_PROMOTE_AFTER,
          gateway: options.gateway,
          model: options.model,
          build,
          capture,
          domCapture,
          viewport,
          threshold,
          maxAttempts,
          maxTokensPerWp: options.shift?.maxTokensPerWp,
          buildGuards: options.buildGuards,
          now: options.now,
        });
        cumulativeTokens += outcome.tokensUsed;
        consecutiveFailures = outcome.passed ? 0 : consecutiveFailures + 1;
        // A heartbeat per screen — the shift dashboard's progress / "is it wedged?" signal.
        emitHeartbeat(options.db, run.id);
      }
    };
    await Promise.all(Array.from({ length: maxParallel }, () => buildWorker()));
    if (stopReason) {
      events.append({
        type: 'shift.stopped',
        runId: run.id,
        payload: { reason: stopReason, cumulativeTokens },
      });
      await notify(
        'shift_stopped',
        `Loom shift stopped: ${stopReason} (project ${options.project}, run ${run.id}).`,
      );
    }

    // ---- INTEGRATION EVAL (cumulative cross-screen regression gate) ----
    // Re-check every passed screen against its baseline: a shared-component change can't silently
    // regress an earlier screen. Skipped on an early shift stop (the run is incomplete anyway).
    if (!stopReason) {
      const passedScreens = targets
        .filter((s) => store.getWorkPackage(byScreen.get(s.key)!.id)!.state === 'passed')
        .map((s) => ({
          screenKey: s.key,
          bRepoDir: join(options.bRepoRoot, s.key),
          baseline: readFileSync(join(baselineDir, `${s.key}.png`)),
          legacyUrl: screenUrl(s, options.legacyBaseUrl),
        }));
      if (passedScreens.length > 1) {
        const regressions = await integrationEval({
          screens: passedScreens,
          capture,
          domCapture,
          viewport,
          threshold,
        });
        if (regressions.length) {
          for (const r of regressions) {
            store.setWorkPackageState(byScreen.get(r.screenKey)!.id, 'failed');
          }
          events.append({
            type: 'integration.regression',
            runId: run.id,
            payload: { regressions },
          });
        } else {
          events.append({
            type: 'integration.passed',
            runId: run.id,
            payload: { screens: passedScreens.length },
          });
        }
      }
    }

    // ---- finish ----
    const outcomes = targets.map((screen): ScreenOutcome => {
      const wp = store.getWorkPackage(byScreen.get(screen.key)!.id)!;
      const best = store.bestEval(wp.id);
      return {
        screenKey: screen.key,
        wpId: wp.id,
        state: wp.state,
        diffPercent: best?.visualPct ?? null,
        attempts: store.listAttempts(wp.id).length,
      };
    });
    const passed = outcomes.filter((o) => o.state === 'passed').length;
    const failed = outcomes.length - passed;
    const targetKeys = targets.map((s) => s.key);
    const coverage = coverageLedger({
      planned: targetKeys,
      crawled: targetKeys,
      built: outcomes.filter((o) => o.state === 'passed').map((o) => o.screenKey),
    });
    const status = stopReason ? 'stopped' : failed === 0 ? 'completed' : 'failed';
    store.finishRun(run.id, status);
    events.append({
      type: 'run.finished',
      runId: run.id,
      payload: { passed, failed, coveragePct: coverage.coveragePct, status, stopReason },
    });
    await notify(
      'run_finished',
      `Loom run ${run.id} finished (${status}): ${passed} passed, ${failed} not passed, coverage ${coverage.coveragePct}%.`,
    );
    // Memory consolidation (L5): a periodic, loss-safe compaction at the run boundary so project
    // facts stay bounded as the Reflector re-discovers the same conventions across shifts. Dedup
    // only here (no recency cap) — it never drops a distinct fact.
    const consolidation = memory.consolidate(options.project);
    if (consolidation.deduped > 0 || consolidation.trimmed > 0) {
      events.append({ type: 'memory.consolidated', runId: run.id, payload: consolidation });
    }
    // Optional OTLP export (L7): stream this run's spans to a collector if one is configured.
    // Best-effort and isolated — a collector being down must never fail or stall the run.
    if (options.otlpEndpoint) {
      try {
        const out = await exportSpansOtlp({
          endpoint: options.otlpEndpoint,
          spans: spans.listForRun(run.id),
        });
        events.append({ type: 'spans.exported', runId: run.id, payload: out });
      } catch (error) {
        events.append({
          type: 'spans.export_failed',
          runId: run.id,
          payload: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    return { runId: run.id, screens: outcomes, passed, failed, coverage, stopReason };
  } finally {
    atlas.close();
  }
}

type ProcessArgs = {
  store: TaskStore;
  events: EventLog;
  runId: string;
  atlas: CodeAtlas;
  screen: Screen;
  wpId: string;
  baseline: Buffer;
  bRepoDir: string;
  legacyUrl: string;
  jspSource: (logicalPath: string) => string | undefined;
  repoMapText: string;
  skills: SkillStore;
  memory: MemoryStore;
  gates: GateStore;
  questions: QuestionStore;
  spans: SpanStore;
  project: string;
  reflectOnPass: boolean;
  skillsDir?: string;
  /** Promotion threshold for recalled skills (see {@link RunPipelineOptions.skillPromoteAfter}). */
  skillPromoteAfter: number;
  gateway: LlmGateway;
  model: string;
  build: BuildStrategy;
  capture: CaptureFn;
  domCapture: DomCaptureFn;
  viewport: Viewport;
  threshold: number;
  maxAttempts: number;
  /** Per-WP token budget — break the FIX loop once a screen has spent it. */
  maxTokensPerWp?: number;
  buildGuards?: Partial<GuardConfig>;
  now?: () => number;
};

/** The result of one screen's BUILD→EVAL→FIX loop — for the shift accounting. */
type WpOutcome = { tokensUsed: number; passed: boolean };

/** Run one screen's BUILD→EVAL→FIX loop until it passes or attempts run out. */
async function processWorkPackage(args: ProcessArgs): Promise<WpOutcome> {
  const { store, events, runId, atlas, screen, wpId } = args;
  mkdirSync(args.bRepoDir, { recursive: true });
  const { text: baseOrder, recalledSkillIds } = buildWorkOrder(atlas, screen, {
    jspSource: args.jspSource,
    repoMap: args.repoMapText,
    recall: { skills: args.skills, memory: args.memory, project: args.project, wpId },
  });
  let lastDiff: number | null = null;
  let lastFindings: DomFinding[] = [];
  let lastStyleFindings: StyleFinding[] = [];
  let tokensUsed = 0;

  // Self-improvement accounting: credit every skill recalled into this order with the screen's
  // outcome. A success can tip an active *generated* skill over its promotion threshold —
  // graduating it to the bundled (global) tier — which we surface as a telemetry event so a
  // human / Mission Control sees the loop compounding. (recordUse only promotes on success.)
  const recordSkillOutcome = (success: boolean): void => {
    for (const id of recalledSkillIds) {
      const r = args.skills.recordUse(id, { success }, { promoteAfter: args.skillPromoteAfter });
      if (r.promoted) {
        events.append({
          type: 'skill.promoted',
          runId,
          wpId,
          payload: { skillId: id, name: r.skill.name, successCount: r.skill.successCount },
        });
      }
    }
  };

  for (let attemptNo = 0; attemptNo < args.maxAttempts; attemptNo++) {
    // Per-WP token budget: once a screen has spent it, stop retrying (it blocks).
    if (args.maxTokensPerWp !== undefined && tokensUsed >= args.maxTokensPerWp) break;
    store.setWorkPackageState(wpId, 'building');
    const attempt = store.createAttempt({
      wpId,
      role: 'builder',
      model: args.model,
      driver: 'openai',
      pid: process.pid,
    });
    events.append({
      type: 'attempt.started',
      runId,
      wpId,
      attemptId: attempt.id,
      payload: { n: attempt.n, screenKey: screen.key },
    });

    const workOrder =
      lastDiff === null
        ? baseOrder
        : baseOrder + fixFeedback(lastDiff, lastFindings, lastStyleFindings);
    let build;
    const buildStart = Date.now();
    try {
      build = await args.build({
        gateway: args.gateway,
        model: args.model,
        bRepoDir: args.bRepoDir,
        workOrder,
        guards: args.buildGuards,
        now: args.now,
      });
    } catch (error) {
      store.finishAttempt(attempt.id, {
        status: 'failed',
        failureReason: error instanceof Error ? error.message : String(error),
      });
      // An errored build is still a (failed) GenAI span — recorded for the cost/Live-Now views.
      args.spans.record({
        traceId: runId,
        runId,
        wpId,
        attemptId: attempt.id,
        name: 'build.attempt',
        kind: 'llm',
        status: 'error',
        durationMs: Date.now() - buildStart,
        attributes: { 'gen_ai.request.model': args.model },
      });
      events.append({
        type: 'attempt.failed',
        runId,
        wpId,
        attemptId: attempt.id,
        payload: { error: true },
      });
      continue;
    }
    tokensUsed += build.usage.inputTokens + build.usage.outputTokens;
    // The GenAI span for this build turn — OTel-shaped (model + token usage), correlated to the
    // run/WP/attempt, powering the cost view, Live Now, and the optional OTLP export.
    args.spans.record({
      traceId: runId,
      runId,
      wpId,
      attemptId: attempt.id,
      name: 'build.attempt',
      kind: 'llm',
      status: build.status === 'completed' ? 'ok' : 'error',
      durationMs: Date.now() - buildStart,
      attributes: {
        'gen_ai.request.model': args.model,
        'gen_ai.usage.input_tokens': build.usage.inputTokens,
        'gen_ai.usage.output_tokens': build.usage.outputTokens,
      },
    });

    if (build.status === 'guard_tripped') {
      store.finishAttempt(attempt.id, {
        status: 'guard_tripped',
        failureReason: build.guard,
        inputTokens: build.usage.inputTokens,
        outputTokens: build.usage.outputTokens,
      });
      events.append({
        type: 'attempt.guard_tripped',
        runId,
        wpId,
        attemptId: attempt.id,
        payload: { guard: build.guard },
      });
      continue;
    }

    // ---- EVAL (visual + structural) ----
    store.setWorkPackageState(wpId, 'evaluating');
    const ev = await evaluateScreen({
      stateKey: screen.key,
      bRepoDir: args.bRepoDir,
      baseline: args.baseline,
      legacyUrl: args.legacyUrl,
      capture: args.capture,
      domCapture: args.domCapture,
      viewport: args.viewport,
      threshold: args.threshold,
    });
    const { diffPercent, findings, styleFindings, passed } = ev;
    store.recordEval({
      wpId,
      attemptId: attempt.id,
      scorecard: ev.scorecard,
      visualPct: diffPercent,
      passed,
    });
    lastDiff = diffPercent;
    lastFindings = findings;
    lastStyleFindings = styleFindings;

    const reason = passed
      ? undefined
      : [
          diffPercent > args.threshold ? `visual diff ${diffPercent.toFixed(3)}%` : '',
          findings.length ? `${findings.length} structural finding(s)` : '',
          styleFindings.length ? `${styleFindings.length} style finding(s)` : '',
        ]
          .filter(Boolean)
          .join('; ');
    store.finishAttempt(attempt.id, {
      status: passed ? 'passed' : 'failed',
      inputTokens: build.usage.inputTokens,
      outputTokens: build.usage.outputTokens,
      failureReason: reason,
    });
    events.append({
      type: 'eval.scored',
      runId,
      wpId,
      attemptId: attempt.id,
      payload: {
        passed,
        diffPercent,
        threshold: args.threshold,
        structuralFindings: findings.length,
        styleFindings: styleFindings.length,
      },
    });

    if (passed) {
      store.setWorkPackageState(wpId, 'passed');
      events.append({
        type: 'wp.passed',
        runId,
        wpId,
        payload: { screenKey: screen.key, diffPercent },
      });
      // A passed screen queues a ship gate — the harness never ships on its own; a human
      // approves (`loom gates approve`) to mark it shipped.
      args.gates.open({
        scopeType: 'wp',
        scopeId: wpId,
        type: 'ship',
        payload: { screenKey: screen.key, diffPercent },
      });
      // REFLECT — best-effort: distil reusable skills + facts. A reflection failure must
      // never un-pass a shipped screen, so it's wrapped and only logged.
      if (args.reflectOnPass) {
        try {
          const notes =
            `Screen "${screen.key}" was rebuilt and passed parity ` +
            `(visual diff ${diffPercent.toFixed(2)}%, structural + computed-style gates clean).` +
            (screen.actionType ? ` Struts action: ${screen.actionType}.` : '');
          const drafted = await reflect(
            args.gateway,
            { skills: args.skills, memory: args.memory },
            { project: args.project, screen: screen.key, notes, model: args.model },
          );
          // Each draft skill opens a skill gate — a human activates it; the harness never does.
          for (const s of drafted.skills) {
            args.gates.open({
              scopeType: 'skill',
              scopeId: s.id,
              type: 'skill',
              payload: { name: s.name, screen: screen.key },
            });
            // Persist the draft as a SKILL.md file (a human still approves it via the gate).
            if (args.skillsDir) {
              writeSkillFile(args.skillsDir, {
                name: s.name,
                description: s.description,
                triggers: s.triggers,
                body: s.body,
              });
            }
          }
          events.append({
            type: 'reflect.drafted',
            runId,
            wpId,
            payload: { skills: drafted.skills.length, facts: drafted.facts.length },
          });
        } catch (error) {
          events.append({
            type: 'reflect.failed',
            runId,
            wpId,
            payload: { error: error instanceof Error ? error.message : String(error) },
          });
        }
      }
      recordSkillOutcome(true);
      return { tokensUsed, passed: true };
    }
    // Worklog (OpenClaw task-flow): record what this attempt tried and why it failed, so the
    // recall step feeds it into the next attempt — the Fixer never repeats a dead end.
    args.memory.remember({
      project: args.project,
      kind: 'worklog',
      scopeId: wpId,
      title: `${screen.key} attempt ${attempt.n} failed`,
      body:
        `Visual diff ${diffPercent.toFixed(2)}% (threshold ${args.threshold}%). ` +
        `${findings.length} structural + ${styleFindings.length} computed-style finding(s).` +
        (reason ? ` ${reason}.` : ''),
    });
    store.setWorkPackageState(wpId, 'fixing');
  }

  store.setWorkPackageState(wpId, 'blocked');
  events.append({
    type: 'wp.blocked',
    runId,
    wpId,
    payload: { screenKey: screen.key, lastDiff, attempts: args.maxAttempts },
  });
  // Escalate to the questions inbox so a human can unblock it — with the worklog of what was tried.
  args.questions.ask({
    runId,
    wpId,
    question:
      `Screen "${screen.key}" did not reach parity after ${args.maxAttempts} attempts ` +
      `(best visual diff ${lastDiff === null ? 'n/a' : `${lastDiff.toFixed(2)}%`}). How should I proceed?`,
    context: {
      screenKey: screen.key,
      lastDiff,
      attempts: args.maxAttempts,
      worklog: args.memory
        .list(args.project, { kind: 'worklog', scopeId: wpId })
        .map((w) => w.body),
    },
  });
  recordSkillOutcome(false);
  return { tokensUsed, passed: false };
}
