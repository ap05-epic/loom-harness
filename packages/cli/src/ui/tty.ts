export type OutputFlags = {
  json?: boolean;
  noColor?: boolean;
  noInput?: boolean;
  quiet?: boolean;
  verbose?: number;
};

export type OutputModeInputs = {
  flags: OutputFlags;
  env: Record<string, string | undefined>;
  stdoutTTY: boolean;
  stdinTTY: boolean;
};

export type OutputMode = {
  json: boolean;
  color: boolean;
  interactive: boolean;
  spinner: boolean;
  quiet: boolean;
  verbose: number;
};

function truthy(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

/**
 * The single source of the CLI's output-mode rules (plan §8c). Precedence:
 * --json wins everything; then NO_COLOR/--no-color for color; then
 * --no-input/CI/non-TTY-stdin for interactivity; non-TTY-stdout drops
 * spinner+color; FORCE_COLOR forces color (but never overrides --json).
 */
export function resolveOutputMode(inputs: OutputModeInputs): OutputMode {
  const { flags, env, stdoutTTY, stdinTTY } = inputs;
  const json = flags.json === true;
  const forceColor = truthy(env.FORCE_COLOR);

  let color: boolean;
  if (json) {
    color = false;
  } else if (forceColor) {
    color = true;
  } else if (flags.noColor || truthy(env.NO_COLOR)) {
    color = false;
  } else {
    color = stdoutTTY;
  }

  let interactive: boolean;
  if (json || flags.noInput || truthy(env.CI) || !stdinTTY) {
    interactive = false;
  } else {
    interactive = true;
  }

  const spinner = !json && stdoutTTY && flags.quiet !== true;

  return {
    json,
    color,
    interactive,
    spinner,
    quiet: flags.quiet === true,
    verbose: flags.verbose ?? 0,
  };
}
