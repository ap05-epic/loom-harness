---
name: menu-nav-shell
description: Model a menu-driven nav shell (e.g. a qpmenu-style dispatcher) where screens live behind menu clicks, not stable URLs — for crawling and for the rebuilt nav.
triggers: [qpmenu, menu, nav shell, dispatcher, FA context, no stable url, javascript nav]
---

# Menu-driven nav shell

Some apps route everything through a menu shell (a `qpmenu`-style dispatcher): clicking a menu item runs JS that posts to a dispatcher with a function code, so screens have **no crawlable URL**. Handle this for both CRAWL and the rebuild.

## Crawl

1. **Start at the menu**, not a deep link — set `crawl.startPath` to the menu entry. Synthetic URL nav won't reach the screens; the **AI-explorer** clicks the menu tree.
2. **Record the dispatch contract** per screen: the function/FA code + params the menu JS posts. That tuple (not a URL) is the screen's identity — it becomes the nav edge in the UI atlas.
3. **Mind entitlement gating:** the menu shows different items per role; crawl with the role(s) the rebuild must serve.

## Rebuild

4. **Keep the same nav model.** Rebuild the menu as data (the same tree + labels + dispatch tuples) → a React router that maps a menu selection to the screen component. The user sees the identical menu and lands on the identical screen.
5. **Preserve context plumbing.** A "viewing object"/FA/split context the shell carries between screens becomes app state (a context/store) threaded the same way — losing it breaks deep screens.

## Parity gotchas

- The menu usually persists across screens (a left rail) — it's a layout region (see [[tiles-layout-to-react]]), not per-screen markup.
- Some items open a popup/overlay rather than navigate — model those as modals, and crawl them as their own states.
- Don't invent clean URLs the backend doesn't accept; the dispatch contract is the API until a new endpoint exists.
