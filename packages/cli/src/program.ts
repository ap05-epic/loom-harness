import { Command } from 'commander';
import { createContext, type GlobalFlags } from './context.js';
import { EXIT, mapError } from './errors.js';
import type { ArgSpec, CommandInput, CommandRegistry, CommandSpec } from './registry.js';
import { banner } from './ui/banner.js';

export type ProgramDeps = {
  version: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  stdoutTTY?: boolean;
  stdinTTY?: boolean;
  write?: (s: string) => void;
  writeErr?: (s: string) => void;
  exit?: (code: number) => void;
};

function toGlobalFlags(g: Record<string, unknown>): GlobalFlags {
  return {
    profile: typeof g.profile === 'string' ? g.profile : undefined,
    dataDir: typeof g.dataDir === 'string' ? g.dataDir : undefined,
    json: g.json === true,
    quiet: g.quiet === true,
    verbose: typeof g.verbose === 'number' ? g.verbose : 0,
    noColor: g.color === false, // commander negates --no-color to color:false
    yes: g.yes === true,
    dryRun: g.dryRun === true,
    noInput: g.input === false, // commander negates --no-input to input:false
  };
}

function mapArgs(specArgs: ArgSpec[] | undefined, positional: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  (specArgs ?? []).forEach((arg, i) => {
    out[arg.name] = positional[i];
  });
  return out;
}

function exitCodeHelp(): string {
  const rows = Object.entries(EXIT)
    .map(([name, code]) => `    ${String(code).padStart(3)}  ${name}`)
    .join('\n');
  return `\nExit codes:\n${rows}\n`;
}

/**
 * Global flags are attached to every leaf command (not the root) so the
 * canonical `loom <command> --json` form parses correctly — commander does
 * not accept root options placed after a subcommand.
 */
function applyGlobalOptions(target: Command): void {
  target
    .option('-p, --profile <dir>', 'profile directory (contains loom.config.yaml)')
    .option('--data-dir <path>', 'data directory (overrides the profile)')
    .option('--json', 'machine-readable JSON output')
    .option('-q, --quiet', 'suppress info diagnostics')
    .option('-v, --verbose', 'verbose output (repeatable)', (_v, prev: number) => prev + 1, 0)
    .option('--no-color', 'disable color')
    .option('-y, --yes', 'assume yes for confirmations')
    .option('--dry-run', 'preview without making changes')
    .option('--no-input', 'never prompt; fail instead');
}

function attach(target: Command, spec: CommandSpec, deps: ProgramDeps): void {
  target.description(spec.describe);
  applyGlobalOptions(target);
  for (const arg of spec.args ?? []) {
    const token = arg.variadic ? `${arg.name}...` : arg.name;
    target.argument(arg.required ? `<${token}>` : `[${token}]`, arg.describe);
  }
  for (const opt of spec.options ?? []) {
    if (opt.defaultValue !== undefined)
      target.option(opt.flags, opt.describe, opt.defaultValue as string);
    else target.option(opt.flags, opt.describe);
  }
  if (spec.examples?.length) {
    target.addHelpText('after', `\nExamples:\n${spec.examples.map((e) => `  $ ${e}`).join('\n')}`);
  }

  target.action(async (...actionArgs: unknown[]) => {
    const localOpts = (actionArgs[actionArgs.length - 2] as Record<string, unknown>) ?? {};
    const positional = actionArgs.slice(0, actionArgs.length - 2);
    const flags = toGlobalFlags(localOpts);

    const ctx = createContext({
      command: spec.name.replace(/ /g, '.'),
      flags,
      version: deps.version,
      env: deps.env,
      cwd: deps.cwd,
      stdoutTTY: deps.stdoutTTY,
      stdinTTY: deps.stdinTTY,
      write: deps.write,
      writeErr: deps.writeErr,
    });
    const input: CommandInput = { options: localOpts, args: mapArgs(spec.args, positional) };
    const exit = deps.exit ?? ((code: number) => void (process.exitCode = code));

    try {
      const data = await spec.run(ctx, input);
      ctx.sink.result(data);
      ctx.sink.flushSuccess(spec.render ? (d) => spec.render!(d, ctx) : undefined);
      exit(ctx.requestedExit);
    } catch (error) {
      const he = mapError(error);
      if (flags.verbose && he.cause instanceof Error && he.cause.stack) {
        ctx.sink.error(he.cause.stack);
      }
      ctx.sink.flushError(he);
      exit(he.exitCode);
    }
  });
}

/** Build the full commander program from the registry. Pure + injectable for tests. */
export function buildProgram(registry: CommandRegistry, deps: ProgramDeps): Command {
  const program = new Command('loom')
    .description('Loom Harness — agentic legacy-UI modernization')
    .version(deps.version)
    .showSuggestionAfterError(true)
    .addHelpText('before', `${banner()}\n`)
    .addHelpText('after', exitCodeHelp());

  const parents = new Map<string, Command>();
  for (const spec of registry.all()) {
    const parts = spec.name.split(' ');
    if (parts.length === 1) {
      attach(program.command(parts[0]!), spec, deps);
    } else {
      const parentName = parts[0]!;
      let parent = parents.get(parentName);
      if (!parent) {
        parent = program.command(parentName).description(`${parentName} commands`);
        parents.set(parentName, parent);
      }
      attach(parent.command(parts.slice(1).join(' ')), spec, deps);
    }
  }
  return program;
}
