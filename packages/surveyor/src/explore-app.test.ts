import { canLaunchBrowser, type DomSnapshot, type SessionDiagnosis } from '@loom/browser';
import { describe, expect, test } from 'vitest';
import { exploreApp, isAuthProvider } from './explore-app.js';
import type { Chooser } from './explorer.js';

describe('isAuthProvider', () => {
  test('flags a sign-in redirect, not the app itself', () => {
    expect(isAuthProvider('https://login.microsoftonline.com/abc/oauth2/v2.0/authorize')).toBe(
      true,
    );
    expect(isAuthProvider('https://oauth2-proxy.devpod-wa01.example.net/oauth2/start')).toBe(true);
    expect(
      isAuthProvider('https://green-hedgehog.devpod-wa01.example.net/proxy/8080/BAA/jsp/login.jsp'),
    ).toBe(false);
    expect(isAuthProvider('not a url')).toBe(false);
  });
});

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
    'waits for late-AJAX controls to appear before reading the page (hydrateMs)',
    async () => {
      // The button is added 600ms after load — without a hydration wait the explorer reads an empty
      // page and does nothing (the BAA #pmenu case).
      const html =
        '<!doctype html><html><body><div id="app"></div>' +
        '<script>setTimeout(function(){' +
        'var b=document.createElement("button");b.textContent="LateButton";' +
        'document.getElementById("app").appendChild(b);},600);</script>' +
        '</body></html>';
      const startUrl = `data:text/html,${encodeURIComponent(html)}`;
      const result = await exploreApp({
        startUrl,
        chooser: async () => null, // don't act — just check the start was read AFTER hydration
        hydrateMs: 4000,
        maxStates: 2,
        maxVisits: 1,
      });
      const texts = result.states.flatMap((s) => collectText(s.dom));
      expect(texts.some((t) => t.includes('LateButton'))).toBe(true);
    },
    30_000,
  );

  test.runIf(liveOk)(
    'waits for a slow page to STOP adding controls before reading (not just the first one)',
    async () => {
      // "First" is present immediately; "Second" appears 800ms later. A slow legacy app (BAA) loads
      // its controls in stages — reading at the first control grabs a half-loaded page, and the next
      // action lands on nothing. The explorer must wait until the control set settles.
      const html =
        '<!doctype html><html><body><button>First</button>' +
        '<script>setTimeout(function(){' +
        'var b=document.createElement("button");b.textContent="Second";' +
        'document.body.appendChild(b);},800);</script></body></html>';
      const startUrl = `data:text/html,${encodeURIComponent(html)}`;
      const result = await exploreApp({
        startUrl,
        chooser: async () => null, // don't act — just check what was read after the page settled
        hydrateMs: 5000,
        maxStates: 2,
        maxVisits: 1,
      });
      const texts = result.states.flatMap((s) => collectText(s.dom));
      expect(texts.some((t) => t.includes('First'))).toBe(true);
      expect(texts.some((t) => t.includes('Second'))).toBe(true); // proves it waited for stability
    },
    30_000,
  );

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

  test.runIf(liveOk)(
    'auto-submits after the last field of a secret form (the FA gateway fires itself)',
    async () => {
      // The FA search: one box + Submit. The chooser ONLY fills $fa and NEVER clicks Submit — the
      // driver must submit on its own, or (the live BAA bug) the value is wiped before it's sent.
      const html =
        '<!doctype html><html><body><input name="fa">' +
        "<button onclick=\"document.body.innerHTML='<h1>Loaded '+document.querySelector('input').value+'</h1>'\">Submit</button>" +
        '</body></html>';
      const startUrl = `data:text/html,${encodeURIComponent(html)}`;
      let filled = false;
      const chooser: Chooser = async (ctx) => {
        const box = ctx.candidates.find((c) => c.kind === 'textbox');
        if (box && !filled) {
          filled = true;
          return { kind: 'fill', ref: box.ref, value: '$fa' };
        }
        return null; // never clicks Submit — the driver must do it
      };
      const result = await exploreApp({
        startUrl,
        chooser,
        secrets: { fa: 'AB10' },
        maxStates: 5,
        maxVisits: 5,
      });
      const texts = result.states.flatMap((s) => collectText(s.dom));
      expect(texts.some((t) => t.includes('Loaded AB10'))).toBe(true); // auto-submit fired with the real FA
    },
    30_000,
  );

  test.runIf(liveOk)(
    'emits a diagnosis when the start screen surfaces no controls (the BAA 0-actions case)',
    async () => {
      const html =
        '<!doctype html><html><head><title>Empty</title></head><body>' +
        '<p>nothing to click here</p></body></html>';
      const startUrl = `data:text/html,${encodeURIComponent(html)}`;
      let diagnosis: SessionDiagnosis | undefined;
      await exploreApp({
        startUrl,
        chooser: async () => null,
        hydrateMs: 500,
        maxStates: 1,
        maxVisits: 1,
        onDiagnostic: (d) => {
          diagnosis = d;
        },
      });
      expect(diagnosis).toBeDefined();
      expect(diagnosis!.title).toBe('Empty');
      expect(diagnosis!.frames[0]!.candidates).toBe(0);
      expect(diagnosis!.frames[0]!.text).toContain('nothing to click');
    },
    30_000,
  );
});
