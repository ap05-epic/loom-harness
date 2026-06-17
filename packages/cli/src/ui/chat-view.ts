import type { Palette } from './colors.js';

// A smooth 10-frame braille spinner — adapted from Hermes Agent (MIT) and common
// CLI practice (see docs/research/adopted-patterns.md). 10 fps reads as calm motion.
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const CLEAR_LINE = '\r\x1b[K';

/** First line of a possibly-multiline tool result, trimmed + capped for a one-line status. */
function headline(text: string, max = 88): string {
  const first = (text.split('\n')[0] ?? '').trim();
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** Render a tiny subset of markdown for assistant replies: headers, bullets, **bold**, `code`. */
export function renderMarkdown(text: string, p: Palette): string {
  const inline = (s: string): string =>
    s
      .replace(/`([^`]+)`/g, (_m, c: string) => p.cyan(c))
      .replace(/\*\*([^*]+)\*\*/g, (_m, b: string) => p.bold(b))
      .replace(/\*([^*\n]+)\*/g, (_m, i: string) => p.italic(i));
  return text
    .split('\n')
    .map((line) => {
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) return p.bold(inline(h[2]!));
      const b = /^(\s*)[-*]\s+(.*)$/.exec(line);
      if (b) return `${b[1]}${p.yellow('•')} ${inline(b[2]!)}`;
      return inline(line);
    })
    .join('\n');
}

/** The chat start banner: the one-line mark + the active model/mode + a hint. */
export function formatBanner(
  info: { provider: string; model: string; mode: string },
  p: Palette,
  unicode: boolean,
): string {
  const mark = unicode ? '│┼│' : '|+|';
  return [
    `${p.yellow(`${mark} loom chat`)}  ${p.dim(`${info.provider}:${info.model} · permission: ${info.mode}`)}`,
    p.dim('talk to it — it maps, runs, and works the inbox for you.  /help · /exit'),
    p.dim((unicode ? '─' : '-').repeat(56)),
  ].join('\n');
}

/** A finished tool call: `✓ name — headline` (or `✗` on failure). */
export function formatToolDone(
  name: string,
  summary: string,
  ok: boolean,
  p: Palette,
  unicode: boolean,
): string {
  const mark = ok ? p.green(unicode ? '✓' : 'OK') : p.red(unicode ? '✗' : 'x');
  return `  ${mark} ${p.bold(name)} ${p.dim(`— ${headline(summary)}`)}`;
}

/** The approval prompt line shown by readline before a gated tool runs. */
export function formatApprovalPrompt(
  name: string,
  risk: string,
  p: Palette,
  unicode: boolean,
): string {
  const dot = p.yellow(unicode ? '•' : '*');
  return `  ${dot} allow ${p.bold(name)} ${p.dim(`(${risk})`)}? ${p.dim('[y/N · a=always · !=all]')} `;
}

/** A live spinner on one line; no-op when not a TTY (so piped/CI output stays clean). */
class Spinner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private label = '';
  private frame = 0;

  constructor(
    private readonly write: (s: string) => void,
    private readonly p: Palette,
    private readonly unicode: boolean,
    private readonly active: boolean,
  ) {}

  private paint(): void {
    const f = this.unicode ? SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length]! : '...';
    this.write(`${CLEAR_LINE}${this.p.yellow(f)} ${this.p.dim(`${this.label}…`)}`);
  }

  start(label: string): void {
    if (!this.active) return;
    if (this.timer) clearInterval(this.timer); // restart-safe (e.g. resuming after an approval prompt)
    this.label = label;
    this.frame = 0;
    this.paint();
    this.timer = setInterval(() => {
      this.frame += 1;
      this.paint();
    }, 90);
  }

  setLabel(label: string): void {
    this.label = label;
    if (this.active && this.timer) this.paint();
  }

  clearLine(): void {
    if (this.active) this.write(CLEAR_LINE);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.clearLine();
  }
}

/**
 * A polished, scrolling chat view bound to a palette + writer. Pure formatters
 * (exported above) are unit-tested directly; this class orchestrates the live
 * spinner and the printed lines. The visual language — `›` prompt, braille
 * spinner, `✓ tool — headline` lines, dim secondary text — follows Hermes/Cline.
 */
export class ChatView {
  private readonly spinner: Spinner;

  constructor(
    private readonly p: Palette,
    private readonly write: (s: string) => void,
    private readonly opts: { unicode: boolean; tty: boolean },
  ) {
    this.spinner = new Spinner(write, p, opts.unicode, opts.tty);
  }

  /** Clear any live spinner, then print a finished line. */
  private flushLine(s: string): void {
    this.spinner.clearLine();
    this.write(`${s}\n`);
  }

  banner(info: { provider: string; model: string; mode: string }): void {
    this.write(`${formatBanner(info, this.p, this.opts.unicode)}\n`);
  }

  /** The readline input prompt string. */
  promptText(): string {
    return `${this.p.yellow(this.opts.unicode ? '›' : '>')} `;
  }

  /** The readline approval prompt string. */
  approvalText(name: string, risk: string): string {
    return formatApprovalPrompt(name, risk, this.p, this.opts.unicode);
  }

  thinking(label = 'thinking'): void {
    this.spinner.start(label);
  }

  toolStart(name: string): void {
    this.spinner.setLabel(`running ${name}`);
  }

  toolDone(name: string, summary: string, ok: boolean): void {
    this.flushLine(formatToolDone(name, summary, ok, this.p, this.opts.unicode));
    this.spinner.setLabel('thinking');
  }

  assistant(text: string): void {
    this.spinner.stop();
    this.write(`\n${renderMarkdown(text, this.p)}\n`);
  }

  note(text: string): void {
    this.flushLine(this.p.dim(text));
  }

  error(text: string): void {
    this.flushLine(this.p.red(`${this.opts.unicode ? '✗' : 'x'} ${text}`));
  }

  stop(): void {
    this.spinner.stop();
  }
}
