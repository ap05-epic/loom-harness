import type { DomSnapshot, Viewport } from '@loom/browser';
import { evaluateScreen } from './eval-screen.js';
import type { StaticServer } from './serve.js';

type Capture = (input: { url: string; viewport: Viewport }) => Promise<Buffer>;
type DomCapture = (input: { url: string; viewport: Viewport }) => Promise<DomSnapshot>;

/** A screen that has already passed — re-checked for regression after later screens land. */
export type PassedScreen = {
  screenKey: string;
  bRepoDir: string;
  baseline: Buffer;
  legacyUrl: string;
};

export type IntegrationRegression = {
  screenKey: string;
  diffPercent: number;
  structuralFindings: number;
  styleFindings: number;
};

export type IntegrationEvalArgs = {
  screens: PassedScreen[];
  capture: Capture;
  domCapture: DomCapture;
  viewport: Viewport;
  threshold: number;
  serve?: (dir: string) => Promise<StaticServer>;
};

/**
 * Cumulative cross-screen regression gate: re-evaluate every previously-passed screen against its
 * own baseline and return the ones that no longer reach parity. A shared layout/component change
 * that silently breaks an earlier screen surfaces here — the conductor treats any regression as a
 * stop-the-line condition rather than letting it ship unnoticed.
 */
export async function integrationEval(args: IntegrationEvalArgs): Promise<IntegrationRegression[]> {
  const regressions: IntegrationRegression[] = [];
  for (const s of args.screens) {
    const ev = await evaluateScreen({
      stateKey: s.screenKey,
      bRepoDir: s.bRepoDir,
      baseline: s.baseline,
      legacyUrl: s.legacyUrl,
      capture: args.capture,
      domCapture: args.domCapture,
      viewport: args.viewport,
      threshold: args.threshold,
      serve: args.serve,
    });
    if (!ev.passed) {
      regressions.push({
        screenKey: s.screenKey,
        diffPercent: ev.diffPercent,
        structuralFindings: ev.findings.length,
        styleFindings: ev.styleFindings.length,
      });
    }
  }
  return regressions;
}
