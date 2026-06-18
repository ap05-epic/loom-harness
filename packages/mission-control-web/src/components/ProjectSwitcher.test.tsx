import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ProjectProvider } from '../project';
import { ProjectSwitcher } from './ProjectSwitcher';

function mock(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

function withClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectProvider>{ui}</ProjectProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ProjectSwitcher', () => {
  test('renders an option per project when there is more than one', async () => {
    mock({ active: 'baa', projects: ['baa', 'demo'] });
    withClient(<ProjectSwitcher />);
    expect(await screen.findByRole('option', { name: 'baa' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'demo' })).toBeInTheDocument();
  });

  test('renders nothing when there is at most one project', () => {
    mock({ active: 'baa', projects: ['baa'] });
    withClient(<ProjectSwitcher />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
