import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { CostPanel } from './CostPanel';

describe('CostPanel', () => {
  test('shows total tokens and a per-model breakdown', () => {
    render(
      <CostPanel
        cost={{ inputTokens: 1200, outputTokens: 800, totalDurationMs: 5000, spans: 4 }}
        costByModel={[
          { model: 'gpt-5.4', tokens: 1500, attempts: 3 },
          { model: 'gpt-5.4-mini', tokens: 500, attempts: 1 },
        ]}
      />,
    );
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.4-mini')).toBeInTheDocument();
    expect(screen.getByText('2k')).toBeInTheDocument(); // total tokens (1200+800)
  });

  test('handles an empty cost set', () => {
    render(
      <CostPanel
        cost={{ inputTokens: 0, outputTokens: 0, totalDurationMs: 0, spans: 0 }}
        costByModel={[]}
      />,
    );
    expect(screen.getByText(/no cost/i)).toBeInTheDocument();
  });
});
