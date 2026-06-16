import { afterAll, describe, expect, test } from 'vitest';
import { canRunJava, LegacyFixture } from './legacy-fixture.js';

// Gated on a JDK being present (dev/pod/CI-with-Java); self-skips otherwise.
const javaOk = canRunJava();

let fixture: LegacyFixture | undefined;
afterAll(async () => {
  await fixture?.stop();
});

describe('LegacyFixture', () => {
  test('canRunJava returns a boolean', () => {
    expect(typeof javaOk).toBe('boolean');
  });

  test.runIf(javaOk)(
    'compiles, starts, and serves the login screen',
    async () => {
      fixture = new LegacyFixture({ port: 8137 });
      const base = await fixture.start();
      const res = await fetch(`${base}login`);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain('Sign In');
      expect(html).toContain('Business Analysis');
    },
    30_000,
  );

  test.runIf(javaOk)('gates protected screens behind login (redirects to /login)', async () => {
    if (!fixture) {
      fixture = new LegacyFixture({ port: 8137 });
      await fixture.start();
    }
    const res = await fetch(`${fixture.baseUrl()}list`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });
});
