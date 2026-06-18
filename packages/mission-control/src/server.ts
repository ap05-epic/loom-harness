import { createReadStream, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { relative, resolve } from 'node:path';
import { applyGateDecision, EventLog, QuestionStore, type SqliteDatabase } from '@loom/core';
import { dashboardState, exploreState, listProjects, wpDetail } from './read-model.js';
import { inventory, type McpInfo } from './inventory.js';
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
};

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

  if (method === 'GET' && pathname === '/') {
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

  // ---- writes: the only mutations Mission Control performs ----
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
  return new Promise<MissionControl>((resolve) => {
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
