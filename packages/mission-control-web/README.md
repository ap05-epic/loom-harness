# @loom/mission-control-web

The **React Mission Control** — the single-page cockpit for watching and driving a Loom run from the browser.

It's a [Vite](https://vitejs.dev) + React + TypeScript app ([TanStack Query](https://tanstack.com/query) for ~2s polling, [Tailwind](https://tailwindcss.com), [Recharts](https://recharts.org), Lucide icons), themed with the [`@loom/tokens`](../tokens) brass palette. It's served by [`@loom/mission-control`](../mission-control)'s HTTP server over the framework-agnostic `/api/*` endpoints — it adds no backend of its own.

## What it shows

- **Dashboard** — the run header, a **kanban board** (a column per pipeline state, cards that move as screens progress), the **live fleet** (each active worker: screen · phase · attempt · elapsed · tokens), the **inbox** (approve/reject gates, answer questions — the only writes), **cost** + **eval** charts, a **screen drill-down** (click a card → attempt timeline + best eval), and the **capabilities inventory**.
- **Live Crawl** — watch a `loom explore` crawl in real time: the current URL, every move as it happens, a thumbnail grid of discovered screens, and a **live token-burn line**. Never a blind spinner.
- **Project switcher** — scopes every view when the harness knows more than one project.

## How it's built & served

`pnpm build` runs `tsc --noEmit` then `vite build` → `dist/` (pure JS — pod-safe). [`@loom/mission-control`](../mission-control)'s server serves `dist/` at `/` (via `defaultWebDistDir()`), and **falls back to the vanilla HTML dashboard** when the bundle is absent — so `loom ui` always works, built or not.

## Develop

```
pnpm --filter @loom/mission-control-web dev         # Vite dev server (proxy /api to a running `loom ui`)
pnpm --filter @loom/mission-control-web test        # Vitest + Testing Library (jsdom)
pnpm --filter @loom/mission-control-web typecheck    # tsc --noEmit
```

See [docs/cockpit.md](../../docs/cockpit.md) for the full picture and the phase-by-phase status.
