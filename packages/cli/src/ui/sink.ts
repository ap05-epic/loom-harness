import { errorEnvelope, successEnvelope } from './json.js';
import type { OutputMode } from './tty.js';
import type { HarnessError } from '../errors.js';

export type SinkOptions = {
  command: string;
  mode: OutputMode;
  /** stdout writer (defaults to process.stdout). */
  write?: (s: string) => void;
  /** stderr writer (defaults to process.stderr). */
  writeErr?: (s: string) => void;
  /** Colorizer for human diagnostics; identity by default (color handled in ui/index). */
  paint?: {
    info: (s: string) => string;
    warn: (s: string) => string;
    error: (s: string) => string;
  };
};

export type DiagnosticLevel = 'info' | 'warn' | 'error';

/**
 * Owns the stdout=result / stderr=diagnostics contract (plan §8c). In --json
 * mode, the single result envelope goes to stdout and all diagnostics go to
 * stderr as NDJSON. In human mode, the result is rendered to stdout and
 * diagnostics to stderr.
 */
export interface OutputSink {
  /** Record the command's single structured result. */
  result(data: unknown): void;
  /** Write a plain line to stdout (used by human renderers). */
  line(text: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Add a non-fatal warning to the success envelope (json) / stderr (human). */
  addWarning(message: string): void;
  flushSuccess(render?: (data: unknown) => void): void;
  flushError(error: HarnessError): void;
}

const noPaint = { info: (s: string) => s, warn: (s: string) => s, error: (s: string) => s };

export function createSink(options: SinkOptions): OutputSink {
  const write = options.write ?? ((s: string) => process.stdout.write(s));
  const writeErr = options.writeErr ?? ((s: string) => process.stderr.write(s));
  const paint = options.paint ?? noPaint;
  const { mode, command } = options;

  let resultData: unknown = null;
  const warnings: string[] = [];

  function diag(level: DiagnosticLevel, message: string): void {
    if (level === 'info' && mode.quiet) return;
    if (mode.json) {
      writeErr(`${JSON.stringify({ level, message })}\n`);
      return;
    }
    const prefix = level === 'error' ? 'x ' : level === 'warn' ? '! ' : 'i ';
    writeErr(`${paint[level](prefix + message)}\n`);
  }

  return {
    result(data) {
      resultData = data;
    },
    line(text) {
      write(`${text}\n`);
    },
    info(message) {
      diag('info', message);
    },
    warn(message) {
      diag('warn', message);
    },
    error(message) {
      diag('error', message);
    },
    addWarning(message) {
      warnings.push(message);
      if (!mode.json) diag('warn', message);
    },
    flushSuccess(render) {
      if (mode.json) {
        write(`${JSON.stringify(successEnvelope(command, resultData, warnings))}\n`);
        return;
      }
      if (render) {
        render(resultData);
      } else if (resultData !== null && resultData !== undefined) {
        write(`${JSON.stringify(resultData, null, 2)}\n`);
      }
    },
    flushError(error) {
      if (mode.json) {
        write(`${JSON.stringify(errorEnvelope(command, error))}\n`);
        return;
      }
      writeErr(`${paint.error(`x ${error.message}`)}\n`);
      if (error.hint) writeErr(`  ${error.hint}\n`);
      if (error.docs) writeErr(`  see ${error.docs}\n`);
    },
  };
}
