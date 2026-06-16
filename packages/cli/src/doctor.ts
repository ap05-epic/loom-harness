import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { detectCopilot } from '@loom/agents';
import { canLaunchBrowser } from '@loom/browser';
import { openDb } from '@loom/core';

export type DoctorCheck = {
  name: string;
  /** Return a human detail string on success; throw on failure. */
  run: () => string | Promise<string>;
  hint?: string;
};

export type DoctorResult = {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
};

const MIN_NODE_MINOR: [number, number] = [20, 11];

export const BUILTIN_CHECKS: DoctorCheck[] = [
  {
    name: 'node-version',
    run: () => {
      const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
      const [needMajor, needMinor] = MIN_NODE_MINOR;
      if (major > needMajor || (major === needMajor && minor >= needMinor)) {
        return `node ${process.versions.node}`;
      }
      throw new Error(`node ${process.versions.node} < required ${needMajor}.${needMinor}`);
    },
    hint: 'Install Node 20.11+ (the pod image or nvm).',
  },
  {
    name: 'sqlite',
    run: () => {
      const db = openDb(':memory:');
      const row = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
      const backend = db.backend;
      db.close();
      return `${backend} OK (SQLite ${row.v})`;
    },
    hint: 'If better-sqlite3 fails, the harness auto-falls back to node:sqlite; force it with HARNESS_SQLITE_BACKEND=node:sqlite.',
  },
  {
    name: 'git',
    run: () => {
      const res = spawnSync('git', ['--version'], { encoding: 'utf8' });
      if (res.status !== 0) throw new Error(res.stderr || 'git not runnable');
      return res.stdout.trim();
    },
    hint: 'git is required for harness update.',
  },
  {
    name: 'pnpm',
    run: () => {
      const pnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: true });
      if (pnpm.status === 0) return `pnpm ${pnpm.stdout.trim()}`;
      const corepack = spawnSync('corepack', ['--version'], { encoding: 'utf8', shell: true });
      if (corepack.status === 0)
        return `pnpm absent; corepack ${corepack.stdout.trim()} present (run: corepack enable)`;
      throw new Error('neither pnpm nor corepack found');
    },
    hint: 'On the pod pnpm is absent — bootstrap with `corepack enable` or `npm i -g pnpm`.',
  },
  {
    name: 'jdk',
    run: () => {
      const res = spawnSync('java', ['-version'], { encoding: 'utf8', shell: true });
      // `java -version` prints to stderr
      const out = (res.stderr || res.stdout || '').split('\n')[0]?.trim();
      if (res.status !== 0 || !out) throw new Error('java not runnable');
      return out;
    },
    hint: 'JDK 17 is needed for the fixture app and Java scanners.',
  },
  {
    // The surveyor (crawl) and evaluator both drive Playwright Chromium, so doctor verifies it
    // actually launches here (the pod has it cached). A slow check (~1-3s) — it really launches.
    name: 'browser',
    run: async () => {
      if (await canLaunchBrowser()) return 'Playwright Chromium launchable';
      throw new Error('Chromium failed to launch');
    },
    hint: 'crawl + eval need Playwright Chromium — install with `npx playwright install chromium`, or set browser.executablePath / PLAYWRIGHT_BROWSERS_PATH (already cached on the pod).',
  },
  {
    // Informational: never fails (the openai-key path is the alternative), but
    // tells the operator whether a GitHub Copilot login is available — the
    // default driver for the many devs who have no direct endpoint key.
    name: 'llm-copilot',
    run: async () => {
      const status = await detectCopilot({ probeAuth: false });
      if (status.installed) {
        const model = status.model ? `, model ${status.model}` : '';
        return `${status.version ?? 'GitHub Copilot CLI'}${model} — usable with driver: copilot (no key/URL; auth verified on first call)`;
      }
      return 'GitHub Copilot CLI not found — run `copilot login` to use driver: copilot, or set an API key for the openai driver';
    },
    hint: 'Most developers auth via Copilot login (driver: copilot, no key). A direct BYOK key (openai driver) is the alternative.',
  },
  {
    // Informational: reports the outbound-proxy posture + whether the LLM endpoint bypasses it.
    name: 'proxy',
    run: () => proxyStatus(process.env),
    hint: 'On the pod, git/npm/Playwright egress through HTTP(S)_PROXY; the LLM endpoint must be in NO_PROXY so model calls bypass it.',
  },
];

/**
 * Summarize the outbound-proxy posture for the pod: is an HTTP(S) proxy configured, and does the
 * LLM endpoint bypass it (it must be in `NO_PROXY`, or model calls get proxied/blocked). Pure +
 * env-injected so it's testable; never echoes the proxy URL's credentials.
 */
export function proxyStatus(env: Record<string, string | undefined>): string {
  const proxy = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (!proxy) return 'no proxy configured (direct egress)';
  let safe = 'configured';
  try {
    safe = new URL(proxy).host; // host:port only — never the user:pass userinfo
  } catch {
    /* don't echo a raw, possibly credential-bearing value */
  }
  const noProxy = (env.NO_PROXY ?? env.no_proxy ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const llm = env.LLM_BASE_URL;
  let note = '';
  if (llm) {
    try {
      const host = new URL(llm).hostname;
      const covered = noProxy.some((p) => {
        const suffix = p.startsWith('.') ? p : `.${p}`;
        return host === p || host === p.replace(/^\./, '') || host.endsWith(suffix);
      });
      note = covered
        ? `; LLM host ${host} bypasses the proxy (NO_PROXY)`
        : `; LLM host ${host} is NOT in NO_PROXY — model calls would be proxied`;
    } catch {
      /* ignore an unparseable LLM_BASE_URL */
    }
  }
  return `proxy ${safe}${note}`;
}

/** The git work-tree root containing `dir`, or null when `dir` isn't inside a git repo. */
export function gitTreeContaining(dir: string): string | null {
  if (!existsSync(dir)) return null;
  // No shell: an array argv passes the path (which may contain spaces) intact.
  const res = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return res.status === 0 && res.stdout.trim() ? res.stdout.trim() : null;
}

/**
 * A context-aware check: the data dir must live OUTSIDE any git clone, so bank data (screenshots,
 * HARs, the database) can never be accidentally committed (risk register #10). Returns null when
 * no data dir is resolved yet (nothing to check).
 */
export function dataDirCheck(dataDir: string | undefined): DoctorCheck | null {
  if (!dataDir) return null;
  return {
    name: 'data-dir',
    run: () => {
      const tree = gitTreeContaining(dataDir);
      if (tree)
        throw new Error(
          `data dir is inside a git clone (${tree}) — project data could be committed`,
        );
      return `${dataDir} is outside any git clone`;
    },
    hint: 'Point --data-dir / LOOM_DATA_DIR at a path OUTSIDE any git repository — project data must never enter the repo.',
  };
}

/** Run checks sequentially; failures never abort the remaining checks. */
export async function runChecks(checks: DoctorCheck[] = BUILTIN_CHECKS): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  for (const check of checks) {
    try {
      const detail = await check.run();
      results.push({ name: check.name, ok: true, detail });
    } catch (error) {
      results.push({
        name: check.name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        hint: check.hint,
      });
    }
  }
  return results;
}
