# @loom/browser

A thin Playwright wrapper for driving a real browser — capturing screenshots now (for the evaluator), and crawling for the surveyor later. Kept separate so the [evaluator](../evaluator/README.md) stays pure and browser-free.

## What it provides

- **`captureScreenshot(options)`** — open a browser, navigate, optionally wait, screenshot, close. Returns a PNG `Buffer`.
- **`BrowserSession`** — reuse one browser to capture several pages (`open()` / `capture()` / `close()`).
- **`canLaunchBrowser(executablePath?)`** — probe whether a browser can launch (used to gate browser-dependent tests and `doctor`).

Options cover the things a legacy app needs: a fixed `viewport` (default 1280×1024), `fullPage`, a saved `storageStatePath` (the SSO auth-state bootstrap), a `waitForSelector`/`waitUntil`, and an `executablePath` override for a pod-provided Chromium.

## Example

```ts
import { captureScreenshot } from '@loom/browser';

const png = await captureScreenshot({
  url: 'https://app/login',
  viewport: { width: 1280, height: 1024 },
  storageStatePath: './auth_state.json', // reuse a logged-in session
});
```

## Browser binary

The Playwright **npm package** installs with `pnpm install`; the **Chromium binary** is a separate one-time download:

```bash
pnpm --filter @loom/browser exec playwright install chromium
```

On a pod that already has a cached browser, point `executablePath` at it instead. Tests that need a browser self-skip where none is installed (e.g. plain CI) and run on dev and the pod.
