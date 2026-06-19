import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, runMigrations } from '../db/db.js';
import { MIGRATIONS } from '../db/migrations.js';
import { MemoryStore, type Memory } from '../memory/memory.js';
import { SkillStore } from '../skills/skills.js';
import type { SqliteDatabase } from '../db/sqlite-driver.js';

/**
 * The on-disk layout of a profile learning root, under the global Loom home (`~/.loom` by default):
 * `<home>/profiles/<profile>/{profile.db, skills/}`. `profile.db` holds profile-tier memory; `skills/`
 * accumulates the profile's auto-built + user-added SKILL.md files.
 */
export function profilePaths(
  homeDir: string,
  profile: string,
): { root: string; db: string; skillsDir: string } {
  const root = join(homeDir, 'profiles', profile);
  return { root, db: join(root, 'profile.db'), skillsDir: join(root, 'skills') };
}

/**
 * The **profile learning root** — durable, cross-project memory and accumulated skills, shared by
 * every project bound to the same profile and fresh when you switch profiles. The loom analog of
 * Hermes's `HERMES_HOME`: it sits *above* the per-project `loom.db` (which stays isolated, ADR 0006)
 * as the shared cross-project layer. Opens (and migrates) `<home>/profiles/<profile>/profile.db`.
 */
export class ProfileStore {
  readonly db: SqliteDatabase;
  readonly memory: MemoryStore;
  readonly skills: SkillStore;
  /** Where the profile's accumulated SKILL.md files live (the mutable, per-profile skill tier). */
  readonly skillsDir: string;

  constructor(
    homeDir: string,
    readonly profile: string,
  ) {
    const paths = profilePaths(homeDir, profile);
    mkdirSync(paths.root, { recursive: true });
    this.db = openDb(paths.db);
    runMigrations(this.db, MIGRATIONS);
    this.memory = new MemoryStore(this.db);
    this.skills = new SkillStore(this.db);
    this.skillsDir = paths.skillsDir;
  }

  /** Remember a profile-tier fact — a cross-cutting process, requirement, or preference. */
  remember(input: { title: string; body: string }): Memory {
    return this.memory.remember({
      project: this.profile,
      kind: 'project_fact',
      title: input.title,
      body: input.body,
    });
  }

  /** Recall profile-tier facts relevant to the given terms (for the chat recall merge). */
  recall(terms: string[], limit = 8): Memory[] {
    return this.memory.recall(this.profile, { terms, limit });
  }

  close(): void {
    this.db.close();
  }
}
