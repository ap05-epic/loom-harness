import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { loadSkillDir } from './load.js';

// The bundled Struts→React conversion skill pack lives at the repo root (ships with the harness).
const CONVERSION_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'skills',
  'conversion',
);

describe('bundled conversion skills', () => {
  const docs = loadSkillDir(CONVERSION_DIR);

  test('all six Struts→React conversion skills load with valid frontmatter', () => {
    expect(docs.map((d) => d.name).sort()).toEqual([
      'frameset-to-react-geometry',
      'jstl-date-parity',
      'large-screen-decomposition',
      'menu-nav-shell',
      'struts-iterate-table-to-react',
      'tiles-layout-to-react',
    ]);
  });

  test('each has a description, triggers, and a procedure body', () => {
    expect(docs).toHaveLength(6);
    for (const d of docs) {
      expect(d.description.length).toBeGreaterThan(20);
      expect(d.triggers.length).toBeGreaterThan(0);
      expect(d.body).toMatch(/## Procedure|## Crawl/);
    }
  });
});
