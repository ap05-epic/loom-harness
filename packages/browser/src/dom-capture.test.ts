import { describe, expect, test } from 'vitest';
import { canLaunchBrowser, captureDom } from './capture.js';

// Needs a launchable browser (no Java — we navigate a data: URL); self-skips otherwise.
const browserOk = await canLaunchBrowser();

const HTML = `<!doctype html><html><body>
  <form action="/login">
    <label>User ID</label>
    <input name="username" type="text">
    <input name="password" type="password">
    <select name="region">
      <option value="">(all)</option>
      <option value="EMEA">EMEA</option>
      <option value="APAC">APAC</option>
    </select>
  </form>
  <script>console.log('should be skipped')</script>
</body></html>`;
const DATA_URL = `data:text/html,${encodeURIComponent(HTML)}`;

describe('captureDom', () => {
  test('canLaunchBrowser returns a boolean', () => {
    expect(typeof browserOk).toBe('boolean');
  });

  test.runIf(browserOk)(
    'extracts a normalized DOM tree with form fields and select options',
    async () => {
      const dom = await captureDom({ url: DATA_URL });

      expect(dom.tag).toBe('body');
      const form = dom.children.find((c) => c.tag === 'form')!;
      expect(form.attrs.action).toBe('/login');

      const inputs = form.children.filter((c) => c.tag === 'input');
      expect(inputs.map((i) => i.attrs.name)).toEqual(['username', 'password']);
      expect(inputs[1]!.attrs.type).toBe('password');

      const select = form.children.find((c) => c.tag === 'select')!;
      expect(select.options).toEqual(['', 'EMEA', 'APAC']);

      const label = form.children.find((c) => c.tag === 'label')!;
      expect(label.text).toBe('User ID');
    },
    30_000,
  );

  test.runIf(browserOk)('skips script/style elements', async () => {
    const dom = await captureDom({ url: DATA_URL });
    expect(dom.children.some((c) => c.tag === 'script')).toBe(false);
  });

  test.runIf(browserOk)('captures computed styles when styleProps is set', async () => {
    const styled = `data:text/html,${encodeURIComponent(
      '<body><p style="font-size:11px;color:rgb(51,51,51)">hi</p></body>',
    )}`;
    const dom = await captureDom({ url: styled, styleProps: ['font-size', 'color'] });
    const p = dom.children.find((c) => c.tag === 'p')!;
    expect(p.styles!['font-size']).toBe('11px');
    expect(p.styles!.color).toBe('rgb(51, 51, 51)');
  });
});
