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
});
