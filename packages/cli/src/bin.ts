#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAll } from './commands/index.js';
import { buildProgram } from './program.js';

// When the harness falls back to Node's built-in SQLite, Node emits a one-time
// experimental notice. Silence only that line so CLI output stays clean.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning?.message;
  if (typeof message === 'string' && message.includes('SQLite is an experimental feature')) return;
  return (originalEmitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

function readVersion(): string {
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(moduleDir, '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const program = buildProgram(registerAll(), { version: readVersion() });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
