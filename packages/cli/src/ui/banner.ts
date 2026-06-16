import pc from 'picocolors';
import { LOOM_LOCKUP, LOOM_LOCKUP_ASCII } from '@loom/tokens';

/**
 * The compact Loom lockup for `loom --help` headers — brass on color terminals,
 * plain-ASCII where Unicode/color isn't safe. picocolors auto-disables on
 * non-TTY / NO_COLOR, so embedding this in help output stays clean in pipes/CI.
 */
export function banner(opts: { color?: boolean; unicode?: boolean } = {}): string {
  const color = opts.color ?? pc.isColorSupported;
  const unicode = opts.unicode ?? color; // dumb terminals / no-color get ASCII
  const art = unicode ? LOOM_LOCKUP : LOOM_LOCKUP_ASCII;
  if (!color) return art;
  return art
    .split('\n')
    .map((line) => pc.yellow(line))
    .join('\n');
}
