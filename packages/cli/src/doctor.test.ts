import { describe, expect, test } from 'vitest';
import { runChecks, type DoctorCheck } from './doctor.js';

describe('runChecks', () => {
  test('built-in environment checks pass on a working dev machine', async () => {
    const results = await runChecks();
    const byName = new Map(results.map((r) => [r.name, r]));
    expect(byName.get('node-version')?.ok).toBe(true);
    expect(byName.get('sqlite')?.ok).toBe(true);
    expect(byName.get('git')?.ok).toBe(true);
  });

  test('failures carry a hint and do not abort the remaining checks', async () => {
    const failing: DoctorCheck = {
      name: 'always-fails',
      run: () => {
        throw new Error('boom');
      },
      hint: 'try turning it off and on again',
    };
    const ok: DoctorCheck = { name: 'always-ok', run: () => 'fine' };
    const results = await runChecks([failing, ok]);
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.detail).toMatch(/boom/);
    expect(results[0]?.hint).toMatch(/turning it off/);
    expect(results[1]?.ok).toBe(true);
  });
});
