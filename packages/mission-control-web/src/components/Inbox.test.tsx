import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { Inbox } from './Inbox';

describe('Inbox', () => {
  test('lists gates and questions; approving fires the callback with the gate id', () => {
    const onGate = vi.fn();
    render(
      <Inbox
        gates={[{ id: 'g1', type: 'ship', scopeId: 'wp_login', payload: null }]}
        questions={[{ id: 'q1', wpId: 'wp_x', question: 'dd.MM or MM/dd?', context: null }]}
        onDecideGate={onGate}
        onAnswerQuestion={vi.fn()}
      />,
    );
    expect(screen.getByText(/ship/i)).toBeInTheDocument();
    expect(screen.getByText(/dd\.MM/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onGate).toHaveBeenCalledWith('g1', 'approve');
  });

  test('answering a question fires the callback with id + text', () => {
    const onAnswer = vi.fn();
    render(
      <Inbox
        gates={[]}
        questions={[{ id: 'q1', wpId: null, question: 'which format?', context: null }]}
        onDecideGate={vi.fn()}
        onAnswerQuestion={onAnswer}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/answer/i), {
      target: { value: 'use dd.MM.yyyy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onAnswer).toHaveBeenCalledWith('q1', 'use dd.MM.yyyy');
  });

  test('an empty inbox is friendly', () => {
    render(<Inbox gates={[]} questions={[]} onDecideGate={vi.fn()} onAnswerQuestion={vi.fn()} />);
    expect(screen.getByText(/nothing waiting/i)).toBeInTheDocument();
  });
});
