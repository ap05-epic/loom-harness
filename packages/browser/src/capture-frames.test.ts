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

describe('CrawlSession.captureFrames', () => {
  test.runIf(liveOk)(
    'captures the main document and each child frame with a framePath',
    async () => {
      const html =
        '<!doctype html><html><body><h1>Outer</h1>' +
        '<iframe name="inner" srcdoc="<h1>Inner screen</h1>"></iframe></body></html>';
      const session = new CrawlSession();
      await session.open();
      try {
        await session.navigate(`data:text/html,${encodeURIComponent(html)}`);
        const frames = await session.captureFrames();

        // main document + the iframe = ≥2 captures
        expect(frames.length).toBeGreaterThanOrEqual(2);
        const main = frames.find((f) => f.framePath === '');
        expect(main && collectText(main.dom).some((t) => t.includes('Outer'))).toBe(true);
        // the iframe's screen is captured under its frame name — invisible to a single doc capture
        const inner = frames.find((f) => f.framePath === 'inner');
        expect(inner && collectText(inner.dom).some((t) => t.includes('Inner screen'))).toBe(true);
      } finally {
        await session.close();
      }
    },
    30_000,
  );
});
