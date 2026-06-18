import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { DashboardState } from '../api';
import { Dashboard } from './Dashboard';

const base: DashboardState = {
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
};

function mockState(state: DashboardState): void {
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

function renderWithClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe('Dashboard', () => {
  test('polls /api/state and renders the run header + kanban board', async () => {
    mockState({
      ...base,
      run: {
        id: 'run_x',
        project: 'baa',
        status: 'running',
        stage: 'build',
        harnessVersion: null,
        startedAt: '2026-06-18T00:00:00Z',
        finishedAt: null,
      },
      screens: [
        { wpId: '1', screenKey: 'login', state: 'building', diffPercent: null, attempts: 1 },
      ],
      counts: { building: 1 },
    });
    renderWithClient(<Dashboard />);
    expect(await screen.findByText('baa')).toBeInTheDocument();
    expect(await screen.findByText('login')).toBeInTheDocument();
  });

  test('shows a clear empty state (never a blind spinner) when there is no run', async () => {
    mockState(base);
    renderWithClient(<Dashboard />);
    expect(await screen.findByText(/no active run/i)).toBeInTheDocument();
  });
});
