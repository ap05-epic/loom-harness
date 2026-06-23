import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodeAtlas } from '@loom/cartographer';
import { normalizePath } from './paths.js';

/** A screen's key → a safe file/component identifier (`loginAction.do` → `loginAction_do`). */
export function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '_');
}

function pascal(s: string): string {
  const p = s
    .replace(/(^|_)([a-zA-Z0-9])/g, (_m, _u, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
  return p || 'Screen';
}

export type AppScreen = {
  key: string;
  /** Route key (last path segment of the action, lowercased) — matches a legacy href's routeKey. */
  route: string;
  importPath: string;
  componentName: string;
};

/** The component file a screen converts into, relative to the app dir, under `--into-app`. */
export function screenComponentPath(key: string): string {
  return join('src', 'screens', `${sanitizeKey(key)}.tsx`);
}

/** Collect every atlas screen that's been converted (has a `src/screens/<key>.tsx`) + its route. */
export function collectAppScreens(appDir: string, atlas: CodeAtlas): AppScreen[] {
  const out: AppScreen[] = [];
  for (const s of atlas.screens()) {
    if (!existsSync(join(appDir, screenComponentPath(s.key)))) continue;
    const route = normalizePath(s.actionPath);
    if (!route) continue;
    const sk = sanitizeKey(s.key);
    out.push({ key: s.key, route, importPath: `./screens/${sk}`, componentName: pascal(sk) });
  }
  return out;
}

/**
 * Generate the React router shell (`App.tsx`) that wires the converted screens together so the app
 * **navigates like the legacy**: a click on any link whose href resolves to a known screen is caught
 * and routed in‑app (no reload), and each screen still fetches its own live data. The backend is
 * untouched — the routes mirror the legacy action paths.
 */
export function generateAppShell(screens: AppScreen[]): string {
  const imports = screens
    .map((s) => `import ${s.componentName} from '${s.importPath}';`)
    .join('\n');
  const routes = screens.map((s) => `  ${JSON.stringify(s.route)}: ${s.componentName},`).join('\n');
  const first = screens[0]?.route ?? '';
  return `import { useEffect, useState, type ComponentType } from 'react';
${imports}

// Route key from a legacy href: last path segment, no query/suffix, lowercased (mirrors the atlas routes).
function routeKey(href: string | null): string | null {
  if (!href) return null;
  let p = href.trim();
  if (p === '' || /^(javascript:|mailto:|tel:|#)/i.test(p)) return null;
  try { if (/^https?:/i.test(p)) p = new URL(p).pathname; } catch { /* keep raw */ }
  p = p.split('?')[0].split('#')[0].replace(/\\.(do|jsp|action)$/i, '');
  return (p.split('/').filter(Boolean).pop() || '').toLowerCase();
}

const ROUTES: Record<string, ComponentType> = {
${routes}
};

const hashRoute = () => decodeURIComponent(location.hash.replace(/^#\\/?/, ''));

/** The connected app: renders the current screen, intercepts in-app links + forms so navigation (and
 *  the FA search) stays in React, hitting the same backend endpoints — no full-page reloads. */
export default function App() {
  const [route, setRoute] = useState<string>(() => hashRoute() || ${JSON.stringify(first)});
  const [reload, setReload] = useState(0); // bump to re-mount the screen so it re-fetches live data
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a) return;
      const key = routeKey(a.getAttribute('href'));
      if (key && ROUTES[key]) {
        e.preventDefault();
        setRoute(key);
        history.replaceState(null, '', '#/' + key);
      }
    };
    const onSubmit = async (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (!form || form.tagName !== 'FORM') return;
      const action = form.getAttribute('action') || '';
      // Let truly external forms submit normally; intercept same-app ones (e.g. the FA search).
      if (/^https?:\\/\\//i.test(action) && !action.includes(location.host)) return;
      e.preventDefault();
      const method = (form.getAttribute('method') || 'get').toUpperCase();
      const fd = new FormData(form);
      const qs = [...fd.entries()]
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
        .join('&');
      try {
        if (method === 'GET') {
          await fetch(action + (action.includes('?') ? '&' : '?') + qs, { credentials: 'include' });
        } else {
          await fetch(action, { method, body: fd, credentials: 'include' });
        }
      } catch {
        /* the screen's own fetch surfaces any error */
      }
      const key = routeKey(action);
      if (key && ROUTES[key]) {
        setRoute(key);
        history.replaceState(null, '', '#/' + key);
      }
      // Re-mount the current screen so it re-fetches with the new server state (e.g. the selected FA).
      setReload((n) => n + 1);
    };
    const onHash = () => setRoute(hashRoute());
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('hashchange', onHash);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
  const Screen = ROUTES[route];
  return Screen ? (
    <Screen key={reload} />
  ) : (
    <div style={{ padding: 20 }}>Screen "{route}" not converted yet.</div>
  );
}
`;
}

/** Write the router shell at `<appDir>/src/App.tsx` from the converted screens. */
export function assembleApp(
  appDir: string,
  atlas: CodeAtlas,
): { screens: AppScreen[]; appPath: string } {
  const screens = collectAppScreens(appDir, atlas);
  const appPath = join(appDir, 'src', 'App.tsx');
  writeFileSync(appPath, generateAppShell(screens));
  return { screens, appPath };
}
