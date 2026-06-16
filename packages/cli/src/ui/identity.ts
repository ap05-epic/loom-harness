import { LOOM_LOCKUP_ASCII, LOOM_SPLASH, THREAD_SCALE } from '@loom/tokens';

/**
 * The Loom startup identity — a Hermes-style panel shown on bare `loom`: the brass LOOM splash
 * over the active project, model/provider, and SQLite backend. Pure + fully gated on capability
 * flags so it's deterministic in tests; the CLI computes color/unicode/truecolor from the TTY.
 */

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;
const YELLOW = `${ESC}[33m`; // 16-color brass fallback

/** A 24-bit foreground escape for a #rrggbb hex. */
function truecolorCode(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${ESC}[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

function paint(s: string, code: string | null): string {
  return code ? `${code}${s}${RESET}` : s;
}

/** Vertical brass gradient (lightest at the top), applied to the six LOOM block rows. */
const GRADIENT = [
  THREAD_SCALE[100],
  THREAD_SCALE[200],
  THREAD_SCALE[300],
  THREAD_SCALE[400],
  THREAD_SCALE[500],
  THREAD_SCALE[600],
];

export type RenderOpts = {
  /** Emit ANSI color. */
  color?: boolean;
  /** Use the Unicode block art (else the plain-ASCII lockup). Defaults to `color`. */
  unicode?: boolean;
  /** Use 24-bit color for a true gradient (else flat brass). */
  truecolor?: boolean;
};

/**
 * Render the LOOM wordmark: a 24-bit brass gradient over the block art on truecolor terminals,
 * flat brass on 16/256-color, the plain-ASCII lockup where Unicode/color isn't safe.
 */
export function splashArt(opts: RenderOpts = {}): string {
  const color = opts.color ?? false;
  const unicode = opts.unicode ?? color;
  const truecolor = opts.truecolor ?? false;

  if (!unicode) {
    const art = LOOM_LOCKUP_ASCII;
    return color
      ? art
          .split('\n')
          .map((l) => paint(l, YELLOW))
          .join('\n')
      : art;
  }

  const lines = LOOM_SPLASH.split('\n');
  if (!color) return lines.join('\n');

  // lines: [0]=top frame, [1..6]=the six LOOM block rows, [7]=H A R N E S S rule, [8]=tagline.
  return lines
    .map((line, i) => {
      if (i >= 1 && i <= 6)
        return paint(line, truecolor ? truecolorCode(GRADIENT[i - 1]!) : YELLOW);
      if (i === 7) return paint(line, truecolor ? truecolorCode(THREAD_SCALE[300]) : YELLOW);
      return paint(line, DIM);
    })
    .join('\n');
}

/** What the identity panel reports about the active environment. */
export type IdentityInfo = {
  version: string;
  /** True once a profile resolves (model/project known); false in a fresh checkout. */
  configured: boolean;
  project?: string;
  model?: string;
  driver?: string;
  /** Human-readable auth note from `describeProvider` (e.g. "Azure key", "Copilot login"). */
  providerAuth?: string;
  modelSelectable?: boolean;
  dataDir?: string;
  profileDir?: string;
  backend?: string;
};

const LABEL_WIDTH = 9;

/**
 * The full startup panel: the splash above a compact key/value block (version · model · project ·
 * backend) and a next-steps hint. Unconfigured environments are pointed at `loom init`.
 */
export function identityPanel(info: IdentityInfo, opts: RenderOpts = {}): string {
  const color = opts.color ?? false;
  const dim = (s: string): string => (color ? paint(s, DIM) : s);
  const brass = (s: string): string =>
    color ? paint(s, opts.truecolor ? truecolorCode(THREAD_SCALE[300]) : YELLOW) : s;
  const row = (label: string, value: string): string =>
    `  ${dim(label.padEnd(LABEL_WIDTH))}${value}`;

  const out: string[] = [splashArt(opts), ''];
  out.push(row('version', brass(info.version)));

  if (info.configured) {
    if (info.model) {
      const note = [info.driver, info.providerAuth].filter(Boolean).join(' · ');
      out.push(row('model', `${brass(info.model)}${note ? `  ${dim(`(${note})`)}` : ''}`));
    }
    const loc = info.dataDir ?? info.profileDir;
    out.push(row('project', `${info.project ?? 'profile'}${loc ? `  ${dim(loc)}` : ''}`));
  } else {
    out.push(row('project', dim('none — run `loom init` to create one')));
  }
  if (info.backend) out.push(row('backend', dim(info.backend)));

  out.push('');
  out.push(
    `  ${dim(
      info.configured
        ? '▸ loom run --shift     loom ui     loom --help'
        : '▸ get started:   loom init     loom doctor     loom --help',
    )}`,
  );
  return out.join('\n');
}
