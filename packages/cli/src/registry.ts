import type { ExitName } from './errors.js';
import type { CliContext } from './context.js';

export type CommandGroup = 'lifecycle' | 'pipeline' | 'observe' | 'work' | 'knowledge';

export type OptionSpec = {
  /** commander flag string, e.g. "--to <tag>" or "-f, --follow". */
  flags: string;
  describe: string;
  defaultValue?: unknown;
};

export type ArgSpec = {
  name: string;
  describe: string;
  required?: boolean;
  variadic?: boolean;
};

/** Parsed inputs handed to a command: merged options + positional args. */
export type CommandInput = {
  options: Record<string, unknown>;
  args: Record<string, unknown>;
};

export type CommandSpec = {
  /** Space-separated path for subcommands, e.g. "profile show". */
  name: string;
  group: CommandGroup;
  describe: string;
  args?: ArgSpec[];
  options?: OptionSpec[];
  /** Documented exit codes (OK is always included). Powers help + conformance. */
  exitCodes: ExitName[];
  examples?: string[];
  /** Pure-ish: resolve context, do the work, return JSON-able data. */
  run: (ctx: CliContext, input: CommandInput) => unknown | Promise<unknown>;
  /** Optional human renderer; if absent, a default renderer prints the data. */
  render?: (data: unknown, ctx: CliContext) => void;
};

export type DefineCommandInput = Omit<CommandSpec, 'exitCodes'> & {
  exitCodes?: ExitName[];
};

/** Build a validated command spec (pure — no global side effects). */
export function defineCommand(input: DefineCommandInput): CommandSpec {
  if (!input.name || !input.name.trim()) {
    throw new Error('defineCommand: name is required');
  }
  const exitCodes = Array.from(new Set<ExitName>(['OK', ...(input.exitCodes ?? [])]));
  return { ...input, exitCodes };
}

/** Collects command specs; the program builds commander from it and the conformance test iterates it. */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandSpec>();

  add(spec: CommandSpec): void {
    if (this.commands.has(spec.name)) {
      throw new Error(`duplicate command name: ${spec.name}`);
    }
    this.commands.set(spec.name, spec);
  }

  get(name: string): CommandSpec | undefined {
    return this.commands.get(name);
  }

  all(): CommandSpec[] {
    return [...this.commands.values()];
  }

  byGroup(group: CommandGroup): CommandSpec[] {
    return this.all().filter((c) => c.group === group);
  }
}
