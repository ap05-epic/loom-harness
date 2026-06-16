/** Escape the LIKE metacharacters so a recall term is matched literally. */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

/**
 * Build a SQLite scoring expression that counts how many of `terms` appear (case-insensitively)
 * in `columnExpr` — the backend-agnostic relevance primitive shared by the memory and skill
 * recalls (no FTS dependency). Returns the SQL snippet plus the `%term%` params to bind, in order.
 *
 * @example
 *   const { expr, params } = termScore("title || ' ' || body", ['date', 'field']);
 *   db.prepare(`SELECT *, (${expr}) AS score FROM memory_index ...`).all(...params, ...);
 */
export function termScore(columnExpr: string, terms: string[]): { expr: string; params: string[] } {
  const expr = terms
    .map(() => `(CASE WHEN lower(${columnExpr}) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)`)
    .join(' + ');
  const params = terms.map((t) => `%${likeEscape(t.toLowerCase())}%`);
  return { expr, params };
}
