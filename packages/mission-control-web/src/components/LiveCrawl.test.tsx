import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { ExploreState } from '../api';
import { LiveCrawl } from './LiveCrawl';

const state: ExploreState = {
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
    lastLabel: 'FA Summary',
    lastEventTs: null,
  },
  screens: [
    { key: 'home', url: 'http://app/home', index: 0 },
    { key: 'fa-summary', url: null, index: 1 },
  ],
  moves: [
    { ts: '2026-06-18T00:00:10Z', action: 'fill', label: '$fa', isNew: false, discovered: 0 },
    { ts: '2026-06-18T00:00:20Z', action: 'click', label: 'Submit', isNew: true, discovered: 1 },
  ],
  totals: {
    screens: 2,
    steps: 5,
    inputTokens: 1200,
    outputTokens: 800,
    tokens: 2000,
    elapsedMs: 30000,
    tokensPerSec: 66.6,
    truncated: false,
    done: false,
  },
};

describe('LiveCrawl', () => {
  test('shows the current URL, the move feed, token totals and screen thumbnails', () => {
    render(
      <LiveCrawl
        state={state}
        series={[
          { elapsedMs: 0, tokens: 0 },
          { elapsedMs: 30000, tokens: 2000 },
        ]}
      />,
    );
    expect(screen.getByText(/dispatcherAction\.do/)).toBeInTheDocument();
    expect(screen.getByText('Submit')).toBeInTheDocument(); // a move label
    expect(screen.getByText('2k')).toBeInTheDocument(); // running tokens
    const thumb = screen.getByAltText('home');
    expect(thumb).toHaveAttribute('src', '/api/explore-shot/home.png');
  });

  test('shows an idle state when no crawl is running', () => {
    render(<LiveCrawl state={null} series={[]} />);
    expect(screen.getByText(/no crawl running/i)).toBeInTheDocument();
  });
});
