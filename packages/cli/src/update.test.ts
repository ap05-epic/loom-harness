import { describe, expect, test } from 'vitest';
import { compareSemverTags, resolveTargetTag } from './update.js';

describe('compareSemverTags', () => {
  test('orders by major, minor, patch numerically', () => {
    const tags = ['v0.2.0', 'v0.10.1', 'v0.2.1', 'v1.0.0', 'v0.9.9'];
    const sorted = [...tags].sort(compareSemverTags);
    expect(sorted).toEqual(['v0.2.0', 'v0.2.1', 'v0.9.9', 'v0.10.1', 'v1.0.0']);
  });
});

describe('resolveTargetTag', () => {
  test('picks the highest semver tag when no target given', () => {
    expect(resolveTargetTag(['v0.1.0', 'v0.3.0', 'v0.2.5'])).toBe('v0.3.0');
  });

  test('ignores non-semver tags', () => {
    expect(resolveTargetTag(['nightly', 'v0.1.0', 'test-tag', 'v0.1.1-rc1'])).toBe('v0.1.0');
  });

  test('honors an explicit target if it exists', () => {
    expect(resolveTargetTag(['v0.1.0', 'v0.2.0'], 'v0.1.0')).toBe('v0.1.0');
  });

  test('throws when the explicit target is missing', () => {
    expect(() => resolveTargetTag(['v0.1.0'], 'v9.9.9')).toThrow(/v9\.9\.9/);
  });

  test('throws when no release tags exist at all', () => {
    expect(() => resolveTargetTag(['nightly'])).toThrow(/no release tags/i);
  });
});
