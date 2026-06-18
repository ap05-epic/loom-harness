import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from './App';

// A payload that satisfies the idle state of both /api/state and /api/explore.
const idle = {
  run: null,
  screens: [],
  counts: {},
  liveNow: [],
  gates: [],
  questions: [],
  cost: { inputTokens: 0, outputTokens: 0, totalDurationMs: 0, spans: 0 },
  costByModel: [],
  evalAnalytics: { evaluated: 0, passed: 0, passRate: 0, failureReasons: [] },
  recent: [],
  current: { url: null, lastAction: null, lastLabel: null, lastEventTs: null },
  moves: [],
  totals: {
    screens: 0,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    tokens: 0,
    elapsedMs: 0,
    tokensPerSec: 0,
    truncated: false,
    done: false,
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  test('switches between the Dashboard and the Live Crawl views', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(idle), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    render(<App />);
    expect(await screen.findByText(/no active run/i)).toBeInTheDocument(); // Dashboard by default
    fireEvent.click(screen.getByRole('button', { name: /live crawl/i }));
    expect(await screen.findByText(/no crawl running/i)).toBeInTheDocument(); // Live Crawl view
  });
});
