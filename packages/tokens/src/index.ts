/**
 * `@loom/tokens` — the single source of truth for **Loom Harness** brand tokens,
 * shared by the CLI palette (terminal) and the Mission Control WebUI theme.
 *
 * Mirrors `loom-brand/DESIGN.md`. Keep this file in sync with the brand kit; the
 * design is "woven light on dark" — a warm brass Thread on a cool dark Ink canvas.
 */

export const TAGLINE = 'legacy UI, rebuilt faithfully';

/** Brand + status colors (hex). Mirrors DESIGN.md §8 `palette.ts`. */
export const LOOM = {
  thread: '#E2A74A', // signature brass accent: logo, focus, active, attention
  ink: '#14161F', // dark canvas (default)
  paper: '#F6F3EC', // light canvas
  pass: '#46B17A', // a screen passed the judge
  fail: '#E0533D', // eval failed / error
  info: '#5B8DEF', // running / in progress
  gate: '#E2A74A', // a human is needed (deliberately the Thread hue)
  agent: '#9A7CF0', // LLM / agent spans
} as const;

/** The Thread (brass) accent scale — 50 (lightest) → 900 (darkest). */
export const THREAD_SCALE = {
  50: '#FBF3E6',
  100: '#F6E4C4',
  200: '#EFCF98',
  300: '#E8BB6E',
  400: '#E2A74A',
  500: '#D6942E',
  600: '#B5781F',
  700: '#8E5D18',
  800: '#6B4514',
  900: '#4A2F0E',
} as const;

export type ThemeName = 'dark' | 'light';

/** Semantic tokens components reference, themed dark/light (DESIGN.md §2). */
export const SEMANTIC: Record<ThemeName, Record<string, string>> = {
  dark: {
    bg: '#14161F',
    surface: '#1A1D28',
    surfaceRaised: '#232735',
    border: '#323748',
    text: '#E8EAEF',
    textMuted: '#8A91A1',
    accent: '#E2A74A',
    accentStrong: '#D6942E',
    focusRing: '#E8BB6E',
    pass: '#46B17A',
    fail: '#E0533D',
    info: '#5B8DEF',
    gate: '#E2A74A',
    agent: '#9A7CF0',
  },
  light: {
    bg: '#F6F3EC',
    surface: '#FFFFFF',
    surfaceRaised: '#FBF9F4',
    border: '#E2DDD1',
    text: '#1A1D28',
    textMuted: '#6B7280',
    accent: '#D6942E',
    accentStrong: '#B5781F',
    focusRing: '#D6942E',
    pass: '#46B17A',
    fail: '#E0533D',
    info: '#5B8DEF',
    gate: '#D6942E',
    agent: '#9A7CF0',
  },
};

/** 16-color terminal fallback (the CLI gates this by tty / NO_COLOR). */
export const LOOM_TERM = {
  thread: 'yellow',
  pass: 'green',
  fail: 'red',
  info: 'blue',
  agent: 'magenta',
  muted: 'gray',
} as const;

/** Render `tokens.css` — the WebUI's source of truth (DESIGN.md §8). */
export function tokensCss(): string {
  const d = SEMANTIC.dark;
  const l = SEMANTIC.light;
  return `:root, [data-theme="dark"] {
  --bg:${d.bg}; --surface:${d.surface}; --surface-raised:${d.surfaceRaised}; --border:${d.border};
  --text:${d.text}; --text-muted:${d.textMuted};
  --accent:${d.accent}; --accent-strong:${d.accentStrong}; --focus-ring:${d.focusRing};
  --pass:${d.pass}; --fail:${d.fail}; --info:${d.info}; --gate:${d.gate}; --agent:${d.agent};
  --radius-md:6px; --radius-lg:10px; --space:4px;
  --font-sans:Inter,system-ui,sans-serif; --font-mono:"JetBrains Mono",ui-monospace,monospace;
}
[data-theme="light"] {
  --bg:${l.bg}; --surface:${l.surface}; --surface-raised:${l.surfaceRaised}; --border:${l.border};
  --text:${l.text}; --text-muted:${l.textMuted}; --accent:${l.accent}; --focus-ring:${l.focusRing};
}
`;
}

// ── Brand ASCII art (BRAND.md) ───────────────────────────────────────────────
// UTF-8 box-drawing is primary; the CLI prints the *_ASCII fallback on dumb
// terminals / --no-color, reusing the existing tty/color detection.

/** The mark (a woven grid) — favicons, WebUI sidebar, small headers. */
export const LOOM_MARK = ['  │ │ │', '╭─┬─┬─┬─╮', '├─┼─┼─┼─┤', '╰─┴─┴─┴─╯', '  │ │ │'].join('\n');

/** Plain-ASCII mark for dumb terminals. */
export const LOOM_MARK_ASCII = ['  | | |', '+-+-+-+-+', '+-+-+-+-+', '+-+-+-+-+', '  | | |'].join(
  '\n',
);

/** Compact lockup — the `loom --help` header and logs. */
export const LOOM_LOCKUP = `  │ │ │
╭─┬─┬─┬─╮   LOOM HARNESS
├─┼─┼─┼─┤   ${TAGLINE}
╰─┴─┴─┴─╯
  │ │ │`;

/** Plain-ASCII lockup for dumb terminals. */
export const LOOM_LOCKUP_ASCII = `  | | |
+-+-+-+-+   LOOM HARNESS
+-+-+-+-+   ${TAGLINE}
+-+-+-+-+
  | | |`;

/** Full splash — bare \`loom\` / daemon start (truecolor renders a brass gradient). */
export const LOOM_SPLASH = ` ╭─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─╮
 ██╗      ██████╗  ██████╗ ███╗   ███╗
 ██║     ██╔═══██╗██╔═══██╗████╗ ████║
 ██║     ██║   ██║██║   ██║██╔████╔██║
 ██║     ██║   ██║██║   ██║██║╚██╔╝██║
 ███████╗╚██████╔╝╚██████╔╝██║ ╚═╝ ██║
 ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝     ╚═╝
 ╰─┼─┼─┼── H A R N E S S ──┼─┼─┼─╯
 ${TAGLINE}`;

/** One-line mark for tight spots / status lines. */
export const LOOM_ONELINE = '│┼│ loom';
