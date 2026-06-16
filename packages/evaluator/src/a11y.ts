/**
 * Accessibility parity (evaluator layer 6): the rebuild must not be *less* accessible than the
 * legacy screen. Given the axe-core violations of A and B (captured in-browser; this layer is the
 * pure, deterministic diff), report every violation that is NEW or MORE frequent in the rebuild.
 * Matching or improving a11y is not a regression. Dependency-free — axe runs in the browser layer;
 * its results flow in here.
 */

export type A11yImpact = 'minor' | 'moderate' | 'serious' | 'critical';

/** One axe-core rule violation, with how many nodes tripped it. */
export type A11yViolation = { id: string; impact?: A11yImpact; count: number };

/** A regression: a rule violated more in the rebuild (B) than the legacy (A). */
export type A11yFinding = { id: string; impact?: A11yImpact; was: number; now: number };

/** Every accessibility regression in the rebuild — a new violation, or one that got worse. */
export function diffA11y(legacy: A11yViolation[], rebuild: A11yViolation[]): A11yFinding[] {
  const legacyCount = new Map<string, number>();
  for (const v of legacy) legacyCount.set(v.id, (legacyCount.get(v.id) ?? 0) + v.count);

  const findings: A11yFinding[] = [];
  for (const v of rebuild) {
    const was = legacyCount.get(v.id) ?? 0;
    if (v.count > was) findings.push({ id: v.id, impact: v.impact, was, now: v.count });
  }
  return findings;
}

/** True when the rebuild is less accessible than the legacy screen. */
export function a11yRegressed(legacy: A11yViolation[], rebuild: A11yViolation[]): boolean {
  return diffA11y(legacy, rebuild).length > 0;
}
