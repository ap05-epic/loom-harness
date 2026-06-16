import { describe, expect, test } from 'vitest';
import { a11yRegressed, diffA11y, type A11yViolation } from './a11y.js';

const legacy: A11yViolation[] = [{ id: 'color-contrast', impact: 'serious', count: 1 }];

describe('diffA11y', () => {
  test('flags new and worsened accessibility violations in the rebuild', () => {
    const rebuild: A11yViolation[] = [
      { id: 'color-contrast', impact: 'serious', count: 3 }, // worse (1 → 3)
      { id: 'label', impact: 'critical', count: 2 }, // new
    ];
    const findings = diffA11y(legacy, rebuild);
    expect(findings).toContainEqual({ id: 'color-contrast', impact: 'serious', was: 1, now: 3 });
    expect(findings).toContainEqual({ id: 'label', impact: 'critical', was: 0, now: 2 });
    expect(a11yRegressed(legacy, rebuild)).toBe(true);
  });

  test('a rebuild that matches or improves a11y is not a regression', () => {
    expect(diffA11y(legacy, legacy)).toEqual([]);
    // fewer occurrences than legacy = an improvement, not a regression
    expect(diffA11y(legacy, [{ id: 'color-contrast', impact: 'serious', count: 0 }])).toEqual([]);
    expect(a11yRegressed(legacy, [])).toBe(false);
  });
});
