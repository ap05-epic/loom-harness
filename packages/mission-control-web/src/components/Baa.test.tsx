import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Baa } from './Baa';
import { ProjectProvider } from '../project';

afterEach(() => vi.unstubAllGlobals());

const baaState = {
  run: { id: 'run_1', project: 'baa', status: 'running', stage: 'build' },
  stages: {
    map: { status: 'green', detail: 'mapped' },
    plan: { status: 'green', detail: '2 planned' },
    crawl: { status: 'green', detail: '2 baselines' },
    build: { status: 'running', detail: '1 building…' },
    ship: { status: 'idle', detail: '' },
  },
  gates: [],
  questions: [],
};

describe('Baa', () => {
  test('renders the stage-graph nodes from the polled baa-state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(baaState), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProjectProvider>
          <Baa />
        </ProjectProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('MAP')).toBeInTheDocument();
    expect(await screen.findByText('BUILD')).toBeInTheDocument();
    expect(await screen.findByText('SHIP')).toBeInTheDocument();
    expect(await screen.findByText('run_1')).toBeInTheDocument();
    // a startable node shows a Start (or Running…) action
    expect((await screen.findAllByText(/Start|Running/)).length).toBeGreaterThan(0);
  });
});
