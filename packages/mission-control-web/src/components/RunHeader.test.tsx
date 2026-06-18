import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { RunHeader } from './RunHeader';

describe('RunHeader', () => {
  test('shows the project, status and stage of the active run', () => {
    render(
      <RunHeader
        run={{
          id: 'run_abc123def',
          project: 'baa',
          status: 'running',
          stage: 'build',
          harnessVersion: '1.3.24',
          startedAt: '2026-06-18T00:00:00Z',
          finishedAt: null,
        }}
      />,
    );
    expect(screen.getByText('baa')).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
    expect(screen.getByText(/build/i)).toBeInTheDocument();
  });

  test('shows an empty state when there is no run', () => {
    render(<RunHeader run={null} />);
    expect(screen.getByText(/no active run/i)).toBeInTheDocument();
  });
});
