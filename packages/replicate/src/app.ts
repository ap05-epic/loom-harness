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

/** The connected app: renders the current screen, intercepts in-app links to navigate without reloading. */
export default function App() {
  const [route, setRoute] = useState<string>(() => hashRoute() || ${JSON.stringify(first)});
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
    const onHash = () => setRoute(hashRoute());
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHash);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
  const Screen = ROUTES[route];
  return Screen ? <Screen /> : <div style={{ padding: 20 }}>Screen "{route}" not converted yet.</div>;
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
