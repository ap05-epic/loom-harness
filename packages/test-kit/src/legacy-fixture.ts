import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('workspace root (pnpm-workspace.yaml) not found');
    dir = parent;
  }
}

/** True if a JDK is available to compile/run the fixture (gates fixture tests). */
export function canRunJava(): boolean {
  const res = spawnSync('java', ['-version'], { encoding: 'utf8', shell: true });
  return res.status === 0;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`fixture did not start within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

export type LegacyFixtureOptions = {
  port?: number;
  /** Override the fixture directory (defaults to fixtures/legacy-webapp). */
  dir?: string;
};

/**
 * Compiles and runs the dependency-free legacy fixture (LegacyApp.java) and
 * exposes its base URL. Used to give the surveyor/evaluator a real running
 * legacy app to crawl in tests and in the walking-skeleton pipeline.
 */
export class LegacyFixture {
  readonly port: number;
  readonly dir: string;
  private proc?: ChildProcess;

  constructor(options: LegacyFixtureOptions = {}) {
    this.port = options.port ?? 8090;
    this.dir =
      options.dir ??
      join(findWorkspaceRoot(dirname(fileURLToPath(import.meta.url))), 'fixtures', 'legacy-webapp');
  }

  baseUrl(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  private compile(): void {
    const out = join(this.dir, 'out');
    if (existsSync(join(out, 'LegacyApp.class'))) return;
    const res = spawnSync('javac', ['-d', out, join('src', 'LegacyApp.java')], {
      cwd: this.dir,
      encoding: 'utf8',
      shell: true,
    });
    if (res.status !== 0) throw new Error(`javac failed: ${res.stderr || res.stdout}`);
  }

  async start(): Promise<string> {
    this.compile();
    this.proc = spawn('java', ['-cp', 'out', 'LegacyApp', String(this.port)], {
      cwd: this.dir,
      stdio: 'ignore',
    });
    await waitForHttp(`${this.baseUrl()}login`, 15_000);
    return this.baseUrl();
  }

  async stop(): Promise<void> {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
      this.proc = undefined;
    }
  }
}
