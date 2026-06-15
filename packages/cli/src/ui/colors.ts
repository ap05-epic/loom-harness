import pc from 'picocolors';

export type Palette = {
  dim: (s: string) => string;
  bold: (s: string) => string;
  green: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
};

/** Build a palette whose functions are no-ops when color is disabled. */
export function makePalette(color: boolean): Palette {
  const c = pc.createColors(color);
  return { dim: c.dim, bold: c.bold, green: c.green, red: c.red, yellow: c.yellow, cyan: c.cyan };
}

/** ASCII-safe status symbols (no Unicode, so they survive dumb terminals). */
export const symbols = {
  ok: 'OK',
  fail: 'x',
  warn: '!',
  info: 'i',
  bullet: '-',
  arrow: '->',
} as const;
