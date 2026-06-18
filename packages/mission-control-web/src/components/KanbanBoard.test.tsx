import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { KanbanBoard } from './KanbanBoard';

describe('KanbanBoard', () => {
  test('renders each screen under its state column', () => {
    render(
      <KanbanBoard
        screens={[
          { wpId: '1', screenKey: 'login', state: 'building', diffPercent: null, attempts: 1 },
          { wpId: '2', screenKey: 'list', state: 'passed', diffPercent: 0.4, attempts: 2 },
        ]}
      />,
    );
    expect(screen.getByText('login')).toBeInTheDocument();
    expect(screen.getByText('list')).toBeInTheDocument();
    expect(screen.getByText(/building/i)).toBeInTheDocument();
    expect(screen.getByText(/passed/i)).toBeInTheDocument();
  });

  test('empty columns still render so cards visibly move across', () => {
    render(<KanbanBoard screens={[]} />);
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    expect(screen.getByText(/shipped/i)).toBeInTheDocument();
  });

  test('clicking a screen card invokes onSelect with its wpId', () => {
    const onSelect = vi.fn();
    render(
      <KanbanBoard
        screens={[
          { wpId: 'wp7', screenKey: 'login', state: 'building', diffPercent: null, attempts: 1 },
        ]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('login'));
    expect(onSelect).toHaveBeenCalledWith('wp7');
  });
});
