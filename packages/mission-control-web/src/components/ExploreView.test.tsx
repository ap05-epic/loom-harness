import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ExploreState } from '../api';
import { ExploreView } from './ExploreView';

const empty: ExploreState = {
  run: null,
  current: { url: null, lastAction: null, lastLabel: null, lastEventTs: null },
  screens: [],
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

const running: ExploreState = {
  ...empty,
  run: {
    id: 'run_e',
    project: 'baa',
    status: 'running',
    stage: 'explore',
    startedAt: '2026-06-18T00:00:00Z',
    finishedAt: null,
  },
  current: {
    url: 'http://app/dispatcherAction.do',
    lastAction: 'click',
    lastLabel: 'FA',
    lastEventTs: null,
  },
  totals: { ...empty.totals, screens: 1, steps: 2, tokens: 500, elapsedMs: 10000 },
};

function mock(state: ExploreState) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(state), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

function withClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe('ExploreView', () => {
  test('polls /api/explore and renders the live crawl', async () => {
    mock(running);
    withClient(<ExploreView />);
    expect(await screen.findByText(/dispatcherAction\.do/)).toBeInTheDocument();
  });

  test('shows the idle state when no crawl run exists', async () => {
    mock(empty);
    withClient(<ExploreView />);
    expect(await screen.findByText(/no crawl running/i)).toBeInTheDocument();
  });
});
