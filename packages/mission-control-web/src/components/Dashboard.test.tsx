import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const runX = {
  id: 'run_x',
  project: 'baa',
  status: 'running',
  stage: 'build',
  harnessVersion: null,
  startedAt: '2026-06-18T00:00:00Z',
  finishedAt: null,
};

function mockState(state: DashboardState) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(state), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
      run: runX,
      screens: [
        { wpId: '1', screenKey: 'login', state: 'building', diffPercent: null, attempts: 1 },
      ],
      counts: { building: 1 },
    });
    renderWithClient(<Dashboard />);
    expect(await screen.findByText('baa')).toBeInTheDocument();
    expect(await screen.findByText('login')).toBeInTheDocument();
  });

  test('renders the live fleet, inbox, cost and eval panels from the polled state', async () => {
    mockState({
      ...base,
      run: runX,
      screens: [{ wpId: '2', screenKey: 'list', state: 'passed', diffPercent: 0.3, attempts: 2 }],
      liveNow: [
        {
          wpId: '1',
          screenKey: 'home',
          state: 'building',
          attempt: 1,
          startedAt: '2026-06-18T00:00:00Z',
          tokens: 1500,
          lastEvent: 'build.attempt',
          lastEventTs: null,
        },
      ],
      gates: [{ id: 'g1', type: 'ship', scopeId: 'wp_list', payload: null }],
      questions: [{ id: 'q1', wpId: 'wp_x', question: 'dd.MM or MM/dd?', context: null }],
      costByModel: [{ model: 'gpt-5.4', tokens: 1500, attempts: 3 }],
      evalAnalytics: { evaluated: 1, passed: 1, passRate: 1, failureReasons: [] },
    });
    renderWithClient(<Dashboard />);
    expect(await screen.findByText(/live fleet/i)).toBeInTheDocument();
    expect(await screen.findByText(/dd\.MM/)).toBeInTheDocument(); // the question, in the inbox
    expect(await screen.findByText('gpt-5.4')).toBeInTheDocument(); // the cost panel
    expect(await screen.findByText(/100%/)).toBeInTheDocument(); // the eval pass rate
  });

  test('approving a gate POSTs to /api/gates/:id', async () => {
    const fetchMock = mockState({
      ...base,
      run: runX,
      gates: [{ id: 'g1', type: 'ship', scopeId: 'wp_list', payload: null }],
    });
    renderWithClient(<Dashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/gates/g1'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  test('shows a clear empty state (never a blind spinner) when there is no run', async () => {
    mockState(base);
    renderWithClient(<Dashboard />);
    expect(await screen.findByText(/no active run/i)).toBeInTheDocument();
  });
});
