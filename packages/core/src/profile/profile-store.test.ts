import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ProfileStore, profilePaths } from './profile-store.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'loom-home-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('ProfileStore', () => {
  test('profilePaths lays the root under <home>/profiles/<profile>', () => {
    const p = profilePaths('/h', 'baa');
    expect(p.root).toBe(join('/h', 'profiles', 'baa'));
    expect(p.db).toBe(join('/h', 'profiles', 'baa', 'profile.db'));
    expect(p.skillsDir).toBe(join('/h', 'profiles', 'baa', 'skills'));
  });

  test('stores + recalls profile-tier memory in its own profile.db', () => {
    const ps = new ProfileStore(home, 'baa');
    ps.remember({ title: 'Voice', body: 'write verbs over adjectives, calm and precise' });
    ps.remember({ title: 'Stack', body: 'target React 19 + TypeScript + Vite' });
    expect(existsSync(join(home, 'profiles', 'baa', 'profile.db'))).toBe(true);
    const hits = ps.recall(['verbs', 'calm']);
    expect(hits.some((m) => m.body.includes('verbs over adjectives'))).toBe(true);
    // an irrelevant query doesn't surface it
    expect(ps.recall(['unrelated', 'spaceship'])).toHaveLength(0);
    ps.close();
  });

  test('a different profile gets a separate, fresh root (switching profiles resets the context)', () => {
    const baa = new ProfileStore(home, 'baa');
    baa.remember({ title: 'Pref', body: 'always use dd.MM.yyyy dates' });
    baa.close();
    const other = new ProfileStore(home, 'claims');
    // the new profile starts empty — memory does not leak across profiles
    expect(other.recall(['dates', 'dd'])).toHaveLength(0);
    other.close();
    // …and the original profile still has its memory
    const baaAgain = new ProfileStore(home, 'baa');
    expect(baaAgain.recall(['dates', 'dd']).some((m) => m.body.includes('dd.MM.yyyy'))).toBe(true);
    baaAgain.close();
  });
});
