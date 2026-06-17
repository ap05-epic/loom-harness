import { canLaunchBrowser, type DomSnapshot } from '@loom/browser';
import { describe, expect, test } from 'vitest';
import { exploreApp } from './explore-app.js';
import type { Chooser } from './explorer.js';

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

  test.runIf(liveOk)(
    'substitutes a secret ref ($user) into a fill — the placeholder never reaches the page',
    async () => {
      // The button promotes whatever was TYPED into the input into a heading — so the heading proves
      // exactly what value reached the field.
      const html =
        '<!doctype html><html><body>' +
        '<input name="u">' +
        "<button onclick=\"document.body.innerHTML='<h1>IN '+document.querySelector('input').value+'</h1>'\">Go</button>" +
        '</body></html>';
      const startUrl = `data:text/html,${encodeURIComponent(html)}`;

      let filled = false;
      let clicked = false;
      const chooser: Chooser = async (ctx) => {
        const box = ctx.candidates.find((c) => c.kind === 'textbox');
        if (box && !filled) {
          filled = true;
          return { kind: 'fill', ref: box.ref, value: '$user' }; // the model only ever says "$user"
        }
        const btn = ctx.candidates.find((c) => c.kind !== 'textbox');
        if (btn && !clicked) {
          clicked = true;
          return { kind: 'click', ref: btn.ref };
        }
        return null;
      };

      const result = await exploreApp({
        startUrl,
        chooser,
        secrets: { user: 'alice' },
        maxStates: 5,
        maxVisits: 5,
      });

      const texts = result.states.flatMap((s) => collectText(s.dom));
      expect(texts.some((t) => t.includes('IN alice'))).toBe(true); // the REAL value was typed
      expect(texts.some((t) => t.includes('$user'))).toBe(false); // the placeholder never hit the page
    },
    30_000,
  );
});
