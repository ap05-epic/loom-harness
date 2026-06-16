import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { applyGateDecision, EventLog, QuestionStore, type SqliteDatabase } from '@loom/core';
import { dashboardState } from './read-model.js';
import { dashboardHtml } from './ui.js';

/** A running Mission Control server; `stop()` releases the port. */
export type MissionControl = { url: string; port: number; stop: () => Promise<void> };

export type MissionControlOptions = {
  /** The migrated loom.db. Mission Control reads everything and writes only gate/question decisions. */
  db: SqliteDatabase;
  /** Bind port (default 0 = ephemeral). */
  port?: number;
};

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
  db: SqliteDatabase,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const method = req.method ?? 'GET';

  if (method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(dashboardHtml());
    return;
  }

  if (method === 'GET' && pathname === '/api/state') {
    sendJson(res, 200, dashboardState(db, url.searchParams.get('run') ?? undefined));
    return;
  }

  if (method === 'GET' && pathname === '/api/events') {
    const since = Number(url.searchParams.get('since') ?? '0') || 0;
    const runId = url.searchParams.get('run') ?? undefined;
    const events = new EventLog(db).tailFrom(since, 500, runId ? { runId } : undefined);
    sendJson(res, 200, { events });
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
    void handle(opts.db, req, res).catch(() => {
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
