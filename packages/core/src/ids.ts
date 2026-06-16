import { randomBytes } from 'node:crypto';

/**
 * Sortable, URL/filename-safe id: base36 millisecond timestamp + 64 bits of randomness.
 * Lexicographic order ≈ creation order, which keeps SQLite indexes append-friendly.
 */
export function newId(prefix?: string): string {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rand = randomBytes(8).readBigUInt64BE().toString(36).padStart(13, '0');
  const id = `${ts}${rand}`;
  return prefix ? `${prefix}_${id}` : id;
}
