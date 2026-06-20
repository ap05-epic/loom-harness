import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyGateDecision,
  EventLog,
  QuestionStore,
  TaskStore,
  type SqliteDatabase,
} from '@loom/core';
import { baaState, dashboardState, exploreState, listProjects, wpDetail } from './read-model.js';
import { inventory, type McpInfo } from './inventory.js';
import { handleChatRequest, type ChatRuntime } from './chat-endpoints.js';
import { dashboardHtml } from './ui.js';

/** A running Mission Control server; `stop()` releases the port. */
export type MissionControl = { url: string; port: number; stop: () => Promise<void> };

export type MissionControlOptions = {
  /** The migrated loom.db. Mission Control reads everything and writes only gate/question decisions. */
  db: SqliteDatabase;
  /** Bind port (default 0 = ephemeral). */
  port?: number;
  /** Project scope for the inventory's skills. */
  project?: string;
  /** The project's SKILL.md library dir — surfaced in the inventory. */
  skillsDir?: string;
  /** The DIGIT/Copilot home to scan for the inventory (default `~/.copilot`). */
  digitHome?: string;
  /** External MCP servers from the profile, shown in the inventory. */
  externalMcp?: McpInfo[];
  /** `<data-dir>/explore-shots` — lets the Live Crawl view fetch per-screen thumbnails. */
  exploreShotsDir?: string;
  /**
   * The built React SPA's `dist/` dir. When it contains an `index.html`, Mission Control serves the
   * React app (and its assets) instead of the vanilla HTML dashboard. Omit (or point at an unbuilt
   * dir) to serve vanilla — the pod-safe fallback. The CLI passes {@link defaultWebDistDir}.
   */
  webDistDir?: string;
  /**
   * Enables the browser **Generic Chat** surface (the `/api/chat/*` routes) by supplying what's
   * needed to drive the same agent loop the CLI uses. Omit to run a read-only dashboard (existing
   * behavior). The CLI's `loom ui` passes this when a profile is configured.
   */
  chat?: ChatRuntime;
  /** When chat is disabled (no/broken profile), the human-readable reason — surfaced by the 503. */
  chatDisabledReason?: string;
  /**
   * Enables the **BAA stage graph's** stage-trigger action (`POST /api/baa/stage`). The CLI supplies
   * a spawner that launches a detached `loom <stage>` child, so the conductor stays the single writer
   * and the work survives a UI restart. Omit → the trigger reports 503; the read-only graph still
   * works (`GET /api/baa-state` needs no runtime).
   */
  baa?: BaaRuntime;
  /**
   * Where the onboarding wizard writes `loom.config.yaml` (the global home, `~/.loom`), so the UI can
   * create the project for the operator. Omit → `POST /api/setup` reports 503.
   */
  setupDir?: string;
};

/** The BAA stages a `POST /api/baa/stage` can trigger (each its own resumable `loom <stage>` run). */
export type BaaStageName = 'map' | 'plan' | 'crawl' | 'build';
export type BaaRuntime = {
  /** Launch a detached `loom <stage>` child against `runId` (or a fresh run for the first MAP). */
  spawnStage: (stage: BaaStageName, runId?: string) => { pid?: number };
};

const BAA_STAGE_NAMES = new Set<BaaStageName>(['map', 'plan', 'crawl', 'build']);

/**
 * PIDs of the detached `loom <stage>` children we've spawned, so `POST /api/baa/stop` can halt them.
 * Sequential single-writer stages mean this is usually 0–1 live; dead PIDs are skipped on kill.
 */
const activeStagePids = new Set<number>();
const ACTIVE_WP_STATES = new Set(['building', 'evaluating', 'fixing']);

/** The built React bundle's location, relative to this compiled module (the sibling
 * `@loom/mission-control-web` package's `dist/`). */
export function defaultWebDistDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../mission-control-web/dist');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

/** Serve one static file from the built SPA, confined to its dist dir. Returns false (→ fall through
 * to 404) when the path escapes, isn't a real file, or no bundle is configured. */
function serveStatic(webDist: string | undefined, pathname: string, res: ServerResponse): boolean {
  if (!webDist) return false;
  const root = resolve(webDist);
  const rel = pathname.replace(/^\/+/, '');
  if (!rel) return false;
  const file = resolve(root, rel);
  if (relative(root, file).startsWith('..')) return false;
  try {
    if (!statSync(file).isFile()) return false;
  } catch {
    return false;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
  return true;
}

/** Serve one explore-shot PNG, confined to the shots dir (the route regex blocks slashes; this
 * rejects any `..` escape as defense-in-depth, mirroring the protected-paths guard). */
function serveShot(opts: MissionControlOptions, key: string, res: ServerResponse): void {
  if (!opts.exploreShotsDir) {
    sendJson(res, 404, { error: 'no shots dir' });
    return;
  }
  const root = resolve(opts.exploreShotsDir);
  const file = resolve(root, `${key}.png`);
  if (relative(root, file).startsWith('..') || !existsSync(file)) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function handle(
  opts: MissionControlOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const db = opts.db;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const method = req.method ?? 'GET';

  // The browser Generic Chat surface (its own module — SSE turns + the permission round-trip).
  if (await handleChatRequest(opts, req, res, url, method)) return;

  if (method === 'GET' && pathname === '/') {
    // Serve the built React SPA when present; otherwise the vanilla dashboard (pod-safe fallback).
    const indexFile = opts.webDistDir ? join(opts.webDistDir, 'index.html') : undefined;
    if (indexFile && existsSync(indexFile)) {
      // no-cache so a browser never serves a STALE SPA after `loom update` (hashed assets are
      // immutable; only index.html points at the current bundle).
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
      });
      createReadStream(indexFile).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(dashboardHtml());
    return;
  }

  if (method === 'GET' && pathname === '/api/projects') {
    sendJson(res, 200, {
      active: opts.project ?? null,
      projects: listProjects(db, opts.project ? [opts.project] : []),
    });
    return;
  }

  if (method === 'GET' && pathname === '/api/state') {
    const project = url.searchParams.get('project') ?? opts.project;
    sendJson(
      res,
      200,
      dashboardState(db, url.searchParams.get('run') ?? undefined, project ? { project } : {}),
    );
    return;
  }

  if (method === 'GET' && pathname === '/api/inventory') {
    sendJson(
      res,
      200,
      inventory(db, {
        project: url.searchParams.get('project') ?? opts.project,
        skillsDir: opts.skillsDir,
        digitHome: opts.digitHome,
        externalMcp: opts.externalMcp,
      }),
    );
    return;
  }

  const wpMatch = pathname.match(/^\/api\/wp\/([^/]+)$/);
  if (method === 'GET' && wpMatch) {
    const detail = wpDetail(db, wpMatch[1]!);
    if (!detail) return sendJson(res, 404, { error: 'work package not found' });
    sendJson(res, 200, detail);
    return;
  }

  if (method === 'GET' && pathname === '/api/events') {
    const since = Number(url.searchParams.get('since') ?? '0') || 0;
    const runId = url.searchParams.get('run') ?? undefined;
    const events = new EventLog(db).tailFrom(since, 500, runId ? { runId } : undefined);
    sendJson(res, 200, { events });
    return;
  }

  // The live `loom explore` crawl — current URL, move feed, screens, running tokens.
  if (method === 'GET' && pathname === '/api/explore') {
    const project = url.searchParams.get('project') ?? opts.project;
    sendJson(
      res,
      200,
      exploreState(db, url.searchParams.get('run') ?? undefined, project ? { project } : {}),
    );
    return;
  }
  const shotMatch = pathname.match(/^\/api\/explore-shot\/([A-Za-z0-9_.-]+)\.png$/);
  if (method === 'GET' && shotMatch) {
    serveShot(opts, shotMatch[1]!, res);
    return;
  }

  // The BAA stage graph's read model (per-node status from run.stage + WP states + events + inboxes).
  if (method === 'GET' && pathname === '/api/baa-state') {
    const project = url.searchParams.get('project') ?? opts.project;
    sendJson(
      res,
      200,
      baaState(db, url.searchParams.get('run') ?? undefined, project ? { project } : {}),
    );
    return;
  }

  // ---- writes: the only mutations Mission Control performs ----

  // Trigger one BAA stage — spawns a detached `loom <stage>` child (the conductor stays the single
  // writer; the run survives a UI restart). Enabled only when the CLI supplied a spawner.
  if (method === 'POST' && pathname === '/api/baa/stage') {
    if (!opts.baa) {
      return sendJson(res, 503, {
        error: 'stage triggers are not enabled — start `loom ui` from a configured project',
      });
    }
    const body = await readJson(req);
    const stage = body.stage;
    if (typeof stage !== 'string' || !BAA_STAGE_NAMES.has(stage as BaaStageName)) {
      return sendJson(res, 400, { error: 'stage must be map | plan | crawl | build' });
    }
    const runId = typeof body.runId === 'string' ? body.runId : undefined;
    const { pid } = opts.baa.spawnStage(stage as BaaStageName, runId);
    if (pid) activeStagePids.add(pid);
    sendJson(res, 200, { started: true, pid: pid ?? null });
    return;
  }

  // Halt — the operator's kill switch. Terminates the spawned stage processes and stops the run, so
  // nothing keeps running without a way to stop it. Works without a runtime (the seeded demo too):
  // kills tracked PIDs, marks the run stopped, and blocks its in-flight work packages (resumable — a
  // new BUILD picks them up).
  if (method === 'POST' && pathname === '/api/baa/stop') {
    const body = await readJson(req);
    let killed = 0;
    for (const pid of activeStagePids) {
      try {
        process.kill(pid, 'SIGTERM');
        killed++;
      } catch {
        /* already exited */
      }
    }
    activeStagePids.clear();
    const tasks = new TaskStore(db);
    const runId =
      typeof body.runId === 'string'
        ? body.runId
        : (
            tasks.latestRun({ status: 'running', project: opts.project }) ??
            tasks.latestRun(opts.project ? { project: opts.project } : undefined)
          )?.id;
    let halted = 0;
    if (runId) {
      for (const wp of tasks.listWorkPackages(runId)) {
        if (ACTIVE_WP_STATES.has(wp.state)) {
          tasks.setWorkPackageState(wp.id, 'blocked');
          halted++;
        }
      }
      tasks.finishRun(runId, 'stopped');
      new EventLog(db).append({ type: 'run.stopped', runId, payload: { by: 'operator', killed } });
    }
    sendJson(res, 200, { killed, runId: runId ?? null, halted });
    return;
  }

  // Onboarding: the Setup wizard writes the project's loom.config.yaml so the operator never has to
  // hand-place a file. Backs up any existing config (.bak), writes the new one; the user restarts loom.
  if (method === 'POST' && pathname === '/api/setup') {
    if (!opts.setupDir) return sendJson(res, 503, { error: 'setup is not available here' });
    const body = await readJson(req);
    const config = typeof body.config === 'string' ? body.config : '';
    if (!config.trim()) return sendJson(res, 400, { error: 'config is required' });
    try {
      mkdirSync(opts.setupDir, { recursive: true });
      const path = join(opts.setupDir, 'loom.config.yaml');
      if (existsSync(path)) {
        try {
          copyFileSync(path, `${path}.bak`);
        } catch {
          /* best-effort backup */
        }
      }
      writeFileSync(path, config.endsWith('\n') ? config : `${config}\n`, 'utf8');
      sendJson(res, 200, { ok: true, path });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const gateMatch = pathname.match(/^\/api\/gates\/([^/]+)$/);
  if (method === 'POST' && gateMatch) {
    const body = await readJson(req);
    const decision =
      body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : null;
    if (!decision) return sendJson(res, 400, { error: 'decision must be "approve" or "reject"' });
    // Route through the shared decision so a UI approval applies the same side effect as the CLI:
    // a skill gate activates/archives its drafted skill; a ship gate ships the work package.
    const result = applyGateDecision(
      db,
      gateMatch[1]!,
      decision,
      typeof body.note === 'string' ? body.note : undefined,
    );
    if (!result) return sendJson(res, 404, { error: 'open gate not found' });
    sendJson(res, 200, result);
    return;
  }

  const qMatch = pathname.match(/^\/api\/questions\/([^/]+)$/);
  if (method === 'POST' && qMatch) {
    const body = await readJson(req);
    if (typeof body.answer !== 'string' || !body.answer.trim()) {
      return sendJson(res, 400, { error: 'answer is required' });
    }
    const questions = new QuestionStore(db);
    if (!questions.get(qMatch[1]!)) return sendJson(res, 404, { error: 'question not found' });
    sendJson(res, 200, questions.answer(qMatch[1]!, body.answer));
    return;
  }

  // Built SPA assets (index-*.js / .css / favicon …). Confined to the bundle; falls through to 404.
  if (method === 'GET' && serveStatic(opts.webDistDir, pathname, res)) return;

  sendJson(res, 404, { error: 'not found' });
}

/**
 * Start the local Mission Control server: a read-only dashboard over `loom.db` that visualizes a
 * run gate-to-gate and writes back **only** human gate/question decisions (the single documented
 * exception to the conductor's single-writer rule). Bound to localhost; no external backend.
 */
export function startMissionControl(opts: MissionControlOptions): Promise<MissionControl> {
  const server: Server = createServer((req, res) => {
    void handle(opts, req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
  });
  return new Promise<MissionControl>((resolve, reject) => {
    // Surface a busy port (EADDRINUSE) with an actionable message instead of an unhandled 'error'
    // crash that leaves the OTHER (possibly stale) server running — the root of "loom is out of date".
    server.once('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        const p = opts.port ?? 0;
        reject(
          new Error(
            `port ${p} is already in use — a Loom server is probably already running there. ` +
              `Open http://127.0.0.1:${p} in your browser, or stop the other one (Ctrl-C in its ` +
              `terminal) and try again. If the UI looks out of date after an update, that older ` +
              `server is the reason — stop it, then restart.`,
          ),
        );
      } else reject(err);
    });
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        stop: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections?.();
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}
