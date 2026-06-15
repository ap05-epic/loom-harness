/** Documented, contract-stable exit codes (see plan §8c). */
export const EXIT = {
  OK: 0,
  RUNTIME: 1,
  USAGE: 2,
  CONFIG: 3,
  GATE_REQUIRED: 4,
  BUDGET_EXHAUSTED: 5,
  GUARD_TRIPPED: 6,
  BLOCKED: 7,
  NETWORK: 8,
  NOT_FOUND: 9,
  INTERNAL: 70,
  INTERRUPTED: 130,
} as const;

export type ExitName = keyof typeof EXIT;

export type HarnessErrorOptions = {
  code: string;
  message: string;
  exitCode?: number;
  hint?: string;
  docs?: string;
  cause?: unknown;
};

/** The single error type the CLI throws; caught once at the top of bin.ts. */
export class HarnessError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly hint?: string;
  readonly docs?: string;

  constructor(options: HarnessErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'HarnessError';
    this.code = options.code;
    this.exitCode = options.exitCode ?? EXIT.RUNTIME;
    this.hint = options.hint;
    this.docs = options.docs;
  }
}

export function usageError(message: string, hint?: string): HarnessError {
  return new HarnessError({ code: 'USAGE', exitCode: EXIT.USAGE, message, hint });
}

export function configError(message: string, hint?: string): HarnessError {
  return new HarnessError({ code: 'CONFIG', exitCode: EXIT.CONFIG, message, hint });
}

export function notFoundError(kind: string, id: string, hint?: string): HarnessError {
  return new HarnessError({
    code: 'NOT_FOUND',
    exitCode: EXIT.NOT_FOUND,
    message: `No ${kind} found with id "${id}"`,
    hint,
  });
}

export function networkError(message: string, hint?: string): HarnessError {
  return new HarnessError({ code: 'NETWORK', exitCode: EXIT.NETWORK, message, hint });
}

/**
 * Normalize any throwable into a HarnessError. Passes HarnessError through;
 * recognizes known core-loader failures as CONFIG; everything else becomes
 * INTERNAL (exit 70) with the original preserved as `cause`.
 */
export function mapError(error: unknown): HarnessError {
  if (error instanceof HarnessError) return error;

  if (error instanceof Error) {
    const m = error.message;
    if (/inside a git working tree/i.test(m) || /No harness\.config\.yaml/i.test(m)) {
      return new HarnessError({
        code: 'CONFIG',
        exitCode: EXIT.CONFIG,
        message: m,
        cause: error,
      });
    }
    if (/Invalid harness\.config\.yaml/i.test(m)) {
      return new HarnessError({ code: 'CONFIG', exitCode: EXIT.CONFIG, message: m, cause: error });
    }
    return new HarnessError({
      code: 'INTERNAL',
      exitCode: EXIT.INTERNAL,
      message: m,
      cause: error,
    });
  }

  return new HarnessError({
    code: 'INTERNAL',
    exitCode: EXIT.INTERNAL,
    message: String(error),
    cause: error,
  });
}
