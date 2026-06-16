export type Column = {
  key: string;
  header: string;
  align?: 'left' | 'right';
};

export type TableOptions = {
  /** Truncate any cell wider than this (including the header). */
  maxColWidth?: number;
  /** Text to return when there are no rows. */
  empty?: string;
  /** Column gap (spaces). */
  gap?: number;
};

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return `${text.slice(0, max - 1)}…`;
}

/** Render a width-aware, aligned text table (no color — color is applied by the caller). */
export function renderTable(
  rows: Array<Record<string, unknown>>,
  columns: Column[],
  options: TableOptions = {},
): string {
  if (rows.length === 0) return options.empty ?? '';
  const gap = ' '.repeat(options.gap ?? 2);
  const max = options.maxColWidth ?? Infinity;

  const cells = rows.map((row) =>
    columns.map((col) => clip(row[col.key] === undefined ? '' : String(row[col.key]), max)),
  );
  const headers = columns.map((col) => clip(col.header, max));

  const widths = columns.map((_, i) =>
    Math.max(headers[i]!.length, ...cells.map((r) => r[i]!.length)),
  );

  const pad = (text: string, i: number): string => {
    const w = widths[i]!;
    return columns[i]!.align === 'right' ? text.padStart(w) : text.padEnd(w);
  };

  const headerLine = headers
    .map((h, i) => pad(h, i))
    .join(gap)
    .trimEnd();
  const bodyLines = cells.map((r) =>
    r
      .map((c, i) => pad(c, i))
      .join(gap)
      .trimEnd(),
  );
  return [headerLine, ...bodyLines].join('\n');
}
