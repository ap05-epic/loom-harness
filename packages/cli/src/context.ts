import { loadProfile, type Profile } from '@loom/core';
import { configError } from './errors.js';
import { makePalette } from './ui/colors.js';
import { createSink, type OutputSink } from './ui/sink.js';
import { resolveOutputMode, type OutputMode } from './ui/tty.js';
import { resolveProjectContext } from './workspace.js';

export type GlobalFlags = {
  profile?: string;
  dataDir?: string;
  /** Select a workspace project by name (else the workspace's active project). */
  project?: string;
  /** The workspace directory (else discovered by walking up from cwd). */
  workspace?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: number;
  noColor?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  noInput?: boolean;
};

export type CreateContextOptions = {
  command: string;
  flags: GlobalFlags;
  version?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  stdoutTTY?: boolean;
  stdinTTY?: boolean;
  write?: (s: string) => void;
  writeErr?: (s: string) => void;
};

/** Per-invocation state: resolved output mode + sink + lazy profile access. */
export interface CliContext {
  readonly command: string;
  readonly version: string;
  readonly mode: OutputMode;
  readonly sink: OutputSink;
  readonly flags: GlobalFlags;
  readonly env: Record<string, string | undefined>;
  readonly cwd: string;
  /** Resolve + cache the active profile; throws a CONFIG error if none is found. */
  requireProfile(): Profile;
  /** Request a non-zero exit on an otherwise-successful run (e.g. doctor with failures). */
  requestExit(code: number): void;
  /** The exit code the program should use after a successful flush (default 0). */
  readonly requestedExit: number;
}

export function createContext(options: CreateContextOptions): CliContext {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const mode = resolveOutputMode({
    flags: options.flags,
    env,
    stdoutTTY: options.stdoutTTY ?? Boolean(process.stdout.isTTY),
    stdinTTY: options.stdinTTY ?? Boolean(process.stdin.isTTY),
  });
  const palette = makePalette(mode.color);
  const sink = createSink({
    command: options.command,
    mode,
    write: options.write,
    writeErr: options.writeErr,
    paint: { info: palette.dim, warn: palette.yellow, error: palette.red },
  });

  let cachedProfile: Profile | undefined;
  let requestedExit = 0;

  return {
    command: options.command,
    version: options.version ?? '0.0.0',
    mode,
    sink,
    flags: options.flags,
    env,
    cwd,
    get requestedExit() {
      return requestedExit;
    },
    requestExit(code: number) {
      requestedExit = code;
    },
    requireProfile() {
      if (cachedProfile) return cachedProfile;
      // Resolve the active project (workspace-aware; explicit --profile/--data-dir short-circuit).
      const resolved = resolveProjectContext({
        flags: {
          profile: options.flags.profile,
          dataDir: options.flags.dataDir,
          project: options.flags.project,
          workspace: options.flags.workspace,
        },
        env,
        cwd,
      });
      try {
        cachedProfile = loadProfile(resolved.profileDir, { env, dataDir: resolved.dataDir });
      } catch (error) {
        throw configError(
          error instanceof Error ? error.message : String(error),
          'run `loom init` to create a profile, or pass --profile <dir>',
        );
      }
      return cachedProfile;
    },
  };
}
