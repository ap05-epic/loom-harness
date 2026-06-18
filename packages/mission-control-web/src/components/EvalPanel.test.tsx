import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { EvalPanel } from './EvalPanel';

describe('EvalPanel', () => {
  test('shows the pass rate and the failure-reason pareto', () => {
    render(
      <EvalPanel
        analytics={{
          evaluated: 4,
          passed: 3,
          passRate: 0.75,
          failureReasons: [
            { reason: 'visual diff', count: 5 },
            { reason: 'structural', count: 2 },
          ],
        }}
      />,
    );
    expect(screen.getByText(/75%/)).toBeInTheDocument();
    expect(screen.getByText(/visual diff/)).toBeInTheDocument();
    expect(screen.getByText(/structural/)).toBeInTheDocument();
  });

  test('handles no evaluations yet', () => {
    render(<EvalPanel analytics={{ evaluated: 0, passed: 0, passRate: 0, failureReasons: [] }} />);
    expect(screen.getByText(/no evaluations/i)).toBeInTheDocument();
  });
});
