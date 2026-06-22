import { describe, expect, test } from 'vitest';
import type { DomFinding, FunctionalFinding, StyleFinding } from '@loom/evaluator';
import { buildReport, diffsForLlm, printReport, type ParityInput } from './report.js';

const empty: ParityInput = { visualPct: 0, threshold: 1, dom: [], style: [], forms: [], paths: [] };

const dom: DomFinding[] = [
  { path: 'body>main', code: 'missing-element', detail: 'missing the results table' },
];
const style: StyleFinding[] = [{ path: 'h1', prop: 'color', detail: 'h1 color #000 vs #333' }];
const forms: FunctionalFinding[] = [
  { code: 'missing-field', form: 0, field: 'region', detail: 'dropped the region select' },
];
const paths = [
  {
    code: 'missing_route' as const,
    target: 'popup',
    detail: 'the legacy screen navigates to popup',
  },
];

describe('buildReport', () => {
  test('matched when every gate is clean and visual is within threshold', () => {
    expect(buildReport(empty).matched).toBe(true);
  });

  test('not matched if any gate has findings or visual exceeds threshold', () => {
    expect(buildReport({ ...empty, visualPct: 3 }).matched).toBe(false);
    expect(buildReport({ ...empty, paths }).matched).toBe(false);
    expect(buildReport({ ...empty, dom }).matched).toBe(false);
    expect(buildReport({ ...empty, style }).matched).toBe(false);
    expect(buildReport({ ...empty, forms }).matched).toBe(false);
  });
});

describe('diffsForLlm', () => {
  test('is empty when matched (nothing for the model to fix)', () => {
    expect(diffsForLlm(buildReport(empty))).toBe('');
  });

  test('lists ONLY the concrete differences for the model to fix', () => {
    const text = diffsForLlm(
      buildReport({ visualPct: 4.2, threshold: 1, dom, style, forms, paths }),
    );
    expect(text).toMatch(/4\.2/); // the visual gap
    expect(text).toMatch(/missing the results table/);
    expect(text).toMatch(/region/);
    expect(text).toMatch(/popup/);
  });
});

describe('build errors', () => {
  test('a build error makes it unmatched and short-circuits the fix list to the compile error', () => {
    const r = buildReport({ ...empty, build: ["src/App.tsx:3:1 - error TS1005: ';' expected"] });
    expect(r.matched).toBe(false);
    const text = diffsForLlm(r);
    expect(text).toMatch(/BUILD ERROR/);
    expect(text).toMatch(/TS1005/);
    expect(printReport(r)).toMatch(/build/i);
  });
});

describe('parity gate', () => {
  test('visual gate matches when visual+forms+routes are clean, despite style/structure notes', () => {
    const withNotes: ParityInput = { ...empty, dom, style };
    expect(buildReport(withNotes, 'strict').matched).toBe(false);
    expect(buildReport(withNotes, 'visual').matched).toBe(true);
  });

  test('visual gate still fails on a real visual / forms / routes difference', () => {
    expect(buildReport({ ...empty, visualPct: 5 }, 'visual').matched).toBe(false);
    expect(buildReport({ ...empty, forms }, 'visual').matched).toBe(false);
    expect(buildReport({ ...empty, paths }, 'visual').matched).toBe(false);
  });
});

describe('printReport', () => {
  test('prints a 1:1-match line when matched', () => {
    expect(printReport(buildReport(empty))).toMatch(/1:1|match/i);
  });

  test('summarizes the gaps for the terminal when not matched', () => {
    const bad = printReport(buildReport({ ...empty, visualPct: 5, paths }));
    expect(bad).toMatch(/5/); // visual %
    expect(bad).toMatch(/route|path/i);
  });
});
