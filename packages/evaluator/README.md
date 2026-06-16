# @loom/evaluator

The **judge**: a deterministic, LLM-free comparison of two deployments. Depends only on `@loom/core` — never on `agents` — so the builder can't argue with the verdict (see [ADR 0003](../../docs/decisions/0003-deterministic-evaluator.md)).

## What it provides

- **`diffImages(a, b, options?)`** — a pixel diff of two PNG buffers (via `pixelmatch`/`pngjs`), with **masked rectangles** for dynamic regions. Returns `{ diffPixels, diffPercent, diffPng, … }`. Pure — no browser — so it's fully testable in CI.
- **`scoreVisual(diffs, { threshold, perStateThreshold? })`** — turns per-state×viewport diffs into a verdict: it passes only if every capture is within its threshold, names the worst and failing screens, and supports human-approved per-screen deviations.
- **`diffDom(a, b, options?)`** — the **structural/semantic** layer: a normalized DOM tree compare (tags, ARIA roles, semantic attributes, `<select>` options, labels, link targets) that reports each difference with a readable path + reason code. Catches what a pixel gate misses — a missing dropdown option, a `text`→`password` swap, a relabelled control, a dropped field. Pure (browser-free); the browser's `captureDom` supplies the trees and the conductor runs it as a second gate.
- **`diffStyles(a, b, options?)`** — the **computed-style** layer: compares per-element style digests (typography, colour, borders, spacing — not layout dimensions) over a curated property set. Catches sub-threshold "death by 1px" drift; the conductor runs it as a third gate.

Behavioural-replay, accessibility, and anti-cheat layers join these as the evaluator deepens; each lands with mutation tests.

## Example

```ts
import { diffImages, scoreVisual } from '@loom/evaluator';

const { diffPercent } = diffImages(legacyPng, rebuiltPng, {
  masks: [{ x: 0, y: 0, width: 200, height: 24 }], // a clock in the header
});
const verdict = scoreVisual([{ state: 'login', viewport: 'desktop', diffPercent }], {
  threshold: 1,
});
verdict.passed; // boolean; verdict.failures names any over-threshold screens
```

## Tested

Mutation-tested in both directions: faithful rebuilds pass, sabotaged ones fail with the right reason and offending screen. The visual core is exercised on synthetic images, so no browser is needed in CI.
