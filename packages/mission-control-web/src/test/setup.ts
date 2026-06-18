// Registers @testing-library/jest-dom matchers (e.g. toBeInTheDocument) on Vitest's `expect`,
// and lets React Testing Library auto-clean the DOM between tests (Vitest globals are on).
import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; Recharts' ResponsiveContainer needs it. A no-op stub is enough —
// the container measures 0 in jsdom and renders nothing, which is the intended test behavior.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
