import { describe, expect, test } from 'vitest';
import { gradeScreen, type ScreenLayers } from './grade.js';

const clean: ScreenLayers = { visual: { passed: true, diffPercent: 0.2 } };

describe('gradeScreen', () => {
  test('a screen that clears every layer passes with no reasons', () => {
    expect(gradeScreen(clean)).toEqual({ passed: true, reasons: [] });
  });

  test('any failing layer fails the screen and is named in the reasons', () => {
    const graded = gradeScreen({
      visual: { passed: false, diffPercent: 3.4 },
      structuralFindings: 2,
      functionalFindings: 1,
      a11yFindings: 1,
      copiedAssets: 1,
    });
    expect(graded.passed).toBe(false);
    expect(graded.reasons).toContain('visual diff 3.40%');
    expect(graded.reasons).toContain('structural: 2');
    expect(graded.reasons).toContain('functional: 1');
    expect(graded.reasons).toContain('a11y regressions: 1');
    expect(graded.reasons).toContain('copied assets: 1');
  });

  test('a single sub-threshold layer (e.g. one functional regression) still fails', () => {
    const graded = gradeScreen({ ...clean, functionalFindings: 1 });
    expect(graded.passed).toBe(false);
    expect(graded.reasons).toEqual(['functional: 1']);
  });
});
