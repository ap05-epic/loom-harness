import type { HarnessError } from '../errors.js';

export type SuccessEnvelope = {
  ok: true;
  command: string;
  data: unknown;
  warnings: string[];
};

export type ErrorEnvelope = {
  ok: false;
  command: string;
  error: { code: string; message: string; hint?: string; docs?: string };
};

/** The single JSON document a command prints to stdout in --json mode (success). */
export function successEnvelope(
  command: string,
  data: unknown,
  warnings: string[] = [],
): SuccessEnvelope {
  return { ok: true, command, data, warnings };
}

/** The single JSON document printed to stdout in --json mode on failure. */
export function errorEnvelope(command: string, error: HarnessError): ErrorEnvelope {
  const err: ErrorEnvelope['error'] = { code: error.code, message: error.message };
  if (error.hint !== undefined) err.hint = error.hint;
  if (error.docs !== undefined) err.docs = error.docs;
  return { ok: false, command, error: err };
}
