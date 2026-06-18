import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WpDetail } from '../api';
import { WpInspector } from './WpInspector';

const detail: WpDetail = {
  wpId: 'wp1',
  screenKey: 'login',
  state: 'fixing',
  attempts: [
    {
      n: 1,
      role: 'builder',
      status: 'failed',
      inputTokens: 100,
      outputTokens: 50,
      failureReason: 'visual diff 3%',
    },
    {
      n: 2,
      role: 'fixer',
      status: 'passed',
      inputTokens: 120,
      outputTokens: 60,
      failureReason: null,
    },
  ],
  bestEval: { visualPct: 0.4, passed: true },
};

function mock(d: WpDetail) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(d), {
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

describe('WpInspector', () => {
  test('shows the attempts and best eval for the selected screen', async () => {
    mock(detail);
    withClient(<WpInspector wpId="wp1" onClose={() => {}} />);
    expect(await screen.findByText('login')).toBeInTheDocument();
    expect(await screen.findByText(/builder/i)).toBeInTheDocument();
    expect(await screen.findByText(/visual diff 3%/)).toBeInTheDocument();
  });

  test('renders nothing when no screen is selected', () => {
    const { container } = withClient(<WpInspector wpId={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
