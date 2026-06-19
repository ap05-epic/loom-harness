/**
 * The Loom Harness primary mark — "three keys in the harness." A rounded frame (the harness) holds
 * three keys (the legacy systems it unlocks), crossed by a single brass weft thread (the modern
 * rebuild) woven through them. Mirrors loom-brand/docs/brand/loom-mark.svg; the structure inherits
 * `currentColor` so it adapts to context, while the weft stays brass (--accent).
 */
export function LoomMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Loom Harness"
      className={className}
    >
      <rect x="6" y="6" width="52" height="52" rx="14" stroke="currentColor" strokeWidth="2.5" />
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="22" cy="20" r="3.6" />
        <line x1="22" y1="23.6" x2="22" y2="48" />
        <line x1="22" y1="42" x2="26" y2="42" />
        <line x1="22" y1="46" x2="25" y2="46" />
        <circle cx="32" cy="20" r="3.6" />
        <line x1="32" y1="23.6" x2="32" y2="48" />
        <line x1="32" y1="42" x2="36" y2="42" />
        <line x1="32" y1="46" x2="35" y2="46" />
        <circle cx="42" cy="20" r="3.6" />
        <line x1="42" y1="23.6" x2="42" y2="48" />
        <line x1="42" y1="42" x2="46" y2="42" />
        <line x1="42" y1="46" x2="45" y2="46" />
      </g>
      {/* the weft: the modern rebuild, threading through — always brass */}
      <line
        x1="14"
        y1="32"
        x2="50"
        y2="32"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
