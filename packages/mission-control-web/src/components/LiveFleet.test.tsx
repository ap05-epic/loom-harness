import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { LiveWorker } from '../api';
import { LiveFleet } from './LiveFleet';

const worker = (over: Partial<LiveWorker>): LiveWorker => ({
  wpId: 'w1',
  screenKey: 'login',
  state: 'building',
  attempt: 1,
  startedAt: '2026-06-18T00:00:00Z',
  tokens: 1500,
  lastEvent: 'build.attempt',
  lastEventTs: null,
  ...over,
});

describe('LiveFleet', () => {
  test('renders a card per active worker with screen, phase and tokens', () => {
    render(
      <LiveFleet
        workers={[
          worker({ screenKey: 'login', tokens: 1500 }),
          worker({ wpId: 'w2', screenKey: 'list', state: 'evaluating', tokens: 3000 }),
        ]}
      />,
    );
    expect(screen.getByText('login')).toBeInTheDocument();
    expect(screen.getByText('list')).toBeInTheDocument();
    expect(screen.getByText(/building/i)).toBeInTheDocument();
    expect(screen.getByText(/evaluating/i)).toBeInTheDocument();
    expect(screen.getByText('1.5k')).toBeInTheDocument();
    expect(screen.getByText('3k')).toBeInTheDocument();
  });

  test('shows an idle message when nothing is running', () => {
    render(<LiveFleet workers={[]} />);
    expect(screen.getByText(/no workers running/i)).toBeInTheDocument();
  });
});
