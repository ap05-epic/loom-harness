import { canLaunchBrowser, type DomSnapshot } from '@loom/browser';
import { describe, expect, test } from 'vitest';
import { exploreApp } from './explore-app.js';

// The live explorer needs a launchable browser; self-skips where none is available.
const liveOk = await canLaunchBrowser();

function collectText(dom: DomSnapshot): string[] {
  const out: string[] = [];
  const walk = (n: DomSnapshot): void => {
    if (n.text) out.push(n.text);
    n.children.forEach(walk);
  };
  walk(dom);
  return out;
}

describe('exploreApp (live AI-explorer)', () => {
  test.runIf(liveOk)(
    'discovers a screen reachable only by clicking a button (no link to follow)',
    async () => {
      const html =
        '<!doctype html><html><body>' +
        '<button onclick="document.body.innerHTML=\'<h1>Detail screen</h1>\'">Open detail</button>' +
        '</body></html>';
      const startUrl = `data:text/html,${encodeURIComponent(html)}`;

      const result = await exploreApp({ startUrl, maxStates: 5, maxVisits: 5 });

      // start (the button) + the detail screen = ≥2 states; the detail is reachable only by a click.
      expect(result.states.length).toBeGreaterThanOrEqual(2);
      const texts = result.states.flatMap((s) => collectText(s.dom));
      expect(texts.some((t) => t.includes('Detail screen'))).toBe(true);
    },
    30_000,
  );
});
