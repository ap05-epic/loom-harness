import { describe, expect, test } from 'vitest';
import { renderTable } from './table.js';

describe('renderTable', () => {
  const cols = [
    { key: 'name', header: 'NAME' },
    { key: 'count', header: 'COUNT', align: 'right' as const },
  ];

  test('aligns columns and pads to the widest cell', () => {
    const out = renderTable(
      [
        { name: 'alpha', count: '3' },
        { name: 'b', count: '120' },
      ],
      cols,
    );
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/NAME\s+COUNT/);
    // names column padded to width of "alpha"
    expect(lines[1]).toMatch(/^alpha/);
    expect(lines[2]).toMatch(/^b\s/);
    // right-aligned counts line up on the right edge
    expect(lines[1]!.endsWith('  3')).toBe(true);
    expect(lines[2]!.endsWith('120')).toBe(true);
  });

  test('truncates long cells to maxColWidth with an ellipsis', () => {
    const out = renderTable([{ name: 'a-really-long-value-here', count: '1' }], cols, {
      maxColWidth: 10,
    });
    expect(out).toMatch(/a-really-…/);
  });

  test('renders an empty-state line when there are no rows', () => {
    expect(renderTable([], cols, { empty: '(none)' })).toBe('(none)');
  });

  test('missing cell values render as empty', () => {
    const out = renderTable([{ name: 'x' }], cols);
    expect(out.split('\n')[1]).toMatch(/^x/);
  });
});
