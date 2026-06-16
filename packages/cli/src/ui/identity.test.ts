import { describe, expect, test } from 'vitest';
import { identityPanel, splashArt, type IdentityInfo } from './identity.js';

const ESC = '\x1b';

describe('splashArt', () => {
  test('plain ASCII fallback when unicode is off (dumb terminal / pipe)', () => {
    const art = splashArt({ color: false, unicode: false });
    expect(art).toContain('LOOM HARNESS');
    expect(art).toContain('legacy UI, rebuilt faithfully');
    expect(art).not.toContain('█'); // no block art
    expect(art).not.toContain(ESC); // no color codes
  });

  test('unicode block art, uncolored, contains the wordmark + harness rule', () => {
    const art = splashArt({ color: false, unicode: true });
    expect(art).toContain('█'); // the LOOM block art
    expect(art).toContain('H A R N E S S');
    expect(art).not.toContain(ESC);
  });

  test('truecolor renders a 24-bit brass gradient over the block rows', () => {
    const art = splashArt({ color: true, unicode: true, truecolor: true });
    expect(art).toContain(`${ESC}[38;2;`); // 24-bit color
  });

  test('256/16-color terminals get flat brass, not a 24-bit gradient', () => {
    const art = splashArt({ color: true, unicode: true, truecolor: false });
    expect(art).toContain(ESC); // colored
    expect(art).not.toContain('38;2;'); // but not truecolor
  });
});

describe('identityPanel', () => {
  const configured: IdentityInfo = {
    version: '1.2.3',
    configured: true,
    project: 'baa',
    model: 'gpt-5.4',
    driver: 'openai',
    providerAuth: 'Azure key',
    dataDir: '/home/me/loom-data/baa',
    backend: 'node:sqlite',
  };

  test('a configured profile shows version, model, project, and backend', () => {
    const panel = identityPanel(configured, { color: false, unicode: true });
    expect(panel).toContain('1.2.3');
    expect(panel).toContain('gpt-5.4');
    expect(panel).toContain('baa');
    expect(panel).toContain('node:sqlite');
    expect(panel).toContain('legacy UI, rebuilt faithfully');
    expect(panel).not.toContain(ESC);
  });

  test('an unconfigured environment points the user at `loom init`', () => {
    const panel = identityPanel({ version: '1.2.3', configured: false }, { color: false });
    expect(panel).toContain('1.2.3');
    expect(panel).toMatch(/loom init/);
  });
});
