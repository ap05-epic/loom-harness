import { spawnSync } from 'node:child_process';
import { openDb } from '@harness/core';

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
];

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
