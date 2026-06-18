import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { canLaunchBrowser, CrawlSession, type DomSnapshot } from './capture.js';

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

describe('CrawlSession frame-aware interaction', () => {
  test.runIf(liveOk)(
    'enumerates fillable textboxes and types into them (single frame)',
    async () => {
      const html =
        '<!doctype html><html><body>' +
        '<input name="q" oninput="document.getElementById(\'echo\').textContent=this.value">' +
        '<button>Go</button><div id="echo"></div></body></html>';
      const session = new CrawlSession();
      await session.open();
      try {
        await session.navigate(`data:text/html,${encodeURIComponent(html)}`);
        const cands = await session.enumerateCandidates();

        // a text input is now a fillable candidate, tagged 'textbox'
        const box = cands.find((c) => c.kind === 'textbox');
        expect(box).toBeTruthy();
        // refs carry a frame prefix "<frameIdx>:<local>"
        expect(box!.ref).toContain(':');
        // the button is still a clickable candidate
        expect(cands.some((c) => c.kind !== 'textbox')).toBe(true);

        await session.fillCandidate(box!.ref, 'hello');
        const dom = await session.captureDom();
        expect(collectText(dom).some((t) => t.includes('hello'))).toBe(true);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test.runIf(liveOk)(
    'enumerates and fills controls inside a child frame',
    async () => {
      const inner =
        '<!doctype html><body>' +
        '<input name="q" oninput="document.getElementById(\'e\').textContent=this.value">' +
        '<button>InnerBtn</button><div id="e"></div></body>';
      const html =
        '<!doctype html><html><body><button>MainBtn</button>' +
        `<iframe name="inner" srcdoc="${inner.replace(/"/g, '&quot;')}"></iframe>` +
        '</body></html>';
      const session = new CrawlSession();
      await session.open();
      try {
        await session.navigate(`data:text/html,${encodeURIComponent(html)}`);
        const cands = await session.enumerateCandidates();

        // candidates span more than one frame (distinct frame prefixes)
        const prefixes = new Set(cands.map((c) => c.ref.split(':')[0]));
        expect(prefixes.size).toBeGreaterThanOrEqual(2);

        // the child frame's text input is discoverable — invisible to a main-frame-only enumerate
        const box = cands.find((c) => c.kind === 'textbox');
        expect(box).toBeTruthy();
        expect(box!.ref.split(':')[0]).not.toBe('0');

        await session.fillCandidate(box!.ref, 'world');
        const frames = await session.captureFrames();
        const innerFrame = frames.find((f) => f.framePath === 'inner');
        expect(innerFrame && collectText(innerFrame.dom).some((t) => t.includes('world'))).toBe(
          true,
        );
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test.runIf(liveOk)(
    'clicks a control through an overlay that intercepts pointer events (flyout-menu case)',
    async () => {
      // The button is fully covered by a fixed top-z-index overlay — a real mouse click can't reach
      // it (BAA's open-submenu-over-its-own-links case). A dispatched click fires the handler anyway.
      const html =
        '<!doctype html><html><body>' +
        '<button onclick="document.body.innerHTML=\'<h1>FIRED</h1>\'">Target</button>' +
        '<div style="position:fixed;inset:0;z-index:9999;background:#fff">overlay</div>' +
        '</body></html>';
      const session = new CrawlSession();
      await session.open();
      try {
        await session.navigate(`data:text/html,${encodeURIComponent(html)}`);
        const cands = await session.enumerateCandidates();
        const btn = cands.find((c) => c.kind !== 'textbox');
        expect(btn).toBeTruthy();
        await session.clickCandidate(btn!.ref);
        const dom = await session.captureDom();
        expect(collectText(dom).some((t) => t.includes('FIRED'))).toBe(true);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test.runIf(liveOk)(
    'survives a click that navigates — re-reads the new page instead of crashing',
    async () => {
      // The click triggers a real navigation (reload). Reading the page right after must not throw
      // "execution context was destroyed" — clickCandidate settles and captureDom retries.
      const html =
        '<!doctype html><html><body><h1>HOME</h1>' +
        '<button onclick="location.reload()">Reload</button>' +
        '</body></html>';
      const session = new CrawlSession();
      await session.open();
      try {
        await session.navigate(`data:text/html,${encodeURIComponent(html)}`);
        const cands = await session.enumerateCandidates();
        const btn = cands.find((c) => c.kind !== 'textbox');
        expect(btn).toBeTruthy();
        await session.clickCandidate(btn!.ref); // triggers a navigation
        const dom = await session.captureDom(); // must not throw — re-reads the settled page
        expect(collectText(dom).some((t) => t.includes('HOME'))).toBe(true);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test.runIf(liveOk)(
    'does not crash reading a frameset document (no <body>)',
    async () => {
      const html =
        '<!doctype html><html><frameset cols="100%"><frame src="about:blank"></frameset></html>';
      const session = new CrawlSession();
      await session.open();
      try {
        await session.navigate(`data:text/html,${encodeURIComponent(html)}`, 'domcontentloaded');
        const dom = await session.captureDom(); // bodyless doc — must fall back, not throw
        expect(dom).toBeTruthy();
        expect(['html', 'frameset']).toContain(dom.tag);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test.runIf(liveOk)(
    'captureCombined merges child-frame content into one snapshot (frameset apps)',
    async () => {
      const html =
        '<!doctype html><html><body><h1>OUTER</h1>' +
        '<iframe srcdoc="<h2>INNER-CONTENT</h2>"></iframe></body></html>';
      const session = new CrawlSession();
      await session.open();
      try {
        await session.navigate(`data:text/html,${encodeURIComponent(html)}`);
        const texts = collectText(await session.captureCombined());
        expect(texts.some((t) => t.includes('OUTER'))).toBe(true); // the main document…
        expect(texts.some((t) => t.includes('INNER-CONTENT'))).toBe(true); // …and the child frame
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test.runIf(liveOk)(
    'loads cookies from cookiesPath into the session, normalizing a host/path domain (SSO reuse)',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'loom-cookies-'));
      const file = join(dir, 'cookies.json');
      // The `domain` carries a path (the F12-copy case) — Playwright's addCookies rejects the whole
      // batch unless it's normalized to a bare host, so this also proves the normalization end-to-end.
      writeFileSync(
        file,
        JSON.stringify([
          {
            name: 'sess',
            value: 'abc123',
            domain: 'example.com/proxy/8080/BAA/loginAction.do',
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'Lax',
          },
        ]),
      );
      const session = new CrawlSession({ cookiesPath: file });
      await session.open();
      try {
        const cookies = await session.cookies();
        expect(cookies.some((c) => c.name === 'sess' && c.value === 'abc123')).toBe(true);
      } finally {
        await session.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test.runIf(liveOk)(
    'unfilledTextboxes counts empty fillable inputs (used to know when a form is complete)',
    async () => {
      const html =
        '<!doctype html><html><body><input name="a"><input name="b"><button>Go</button></body></html>';
      const session = new CrawlSession();
      await session.open();
      try {
        await session.navigate(`data:text/html,${encodeURIComponent(html)}`, 'domcontentloaded');
        expect(await session.unfilledTextboxes()).toBe(2); // both empty
        const cands = await session.enumerateCandidates(); // tags elements so fillCandidate can target
        const box = cands.find((c) => c.kind === 'textbox')!;
        await session.fillCandidate(box.ref, 'x');
        expect(await session.unfilledTextboxes()).toBe(1); // one left
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test.runIf(liveOk)(
    'diagnose() reports per-frame control counts and text (debugging 0-candidate pages)',
    async () => {
      const html =
        '<!doctype html><html><head><title>Probe</title></head><body>' +
        '<p>Hello world</p><button>Go</button></body></html>';
      const session = new CrawlSession();
      await session.open();
      try {
        await session.navigate(`data:text/html,${encodeURIComponent(html)}`, 'domcontentloaded');
        const d = await session.diagnose();
        expect(d.title).toBe('Probe');
        expect(d.frames.length).toBeGreaterThanOrEqual(1);
        expect(d.frames[0]!.candidates).toBeGreaterThanOrEqual(1); // the <button>
        expect(d.frames[0]!.text).toContain('Hello world');
      } finally {
        await session.close();
      }
    },
    30_000,
  );
});
