---
name: frameset-to-react-geometry
description: Replace an HTML <frameset>/<iframe> screen with a modern CSS layout that has byte-identical geometry — panel sizes, scroll behavior, borders.
triggers: [frameset, frame, iframe, cols, rows, noresize, scrolling]
---

# Frameset → modern layout, identical geometry

Old screens split the viewport with `<frameset cols="200,*">` (or nested framesets / iframes). Rebuild as a CSS grid/flex layout that lands the panels at the **same pixel geometry**.

## Procedure

1. **Read the frameset tree.** Capture every `cols`/`rows` spec, `border`, `frameborder`, `scrolling`, and `noresize`. Nested framesets → nested grid/flex.
2. **Translate sizes faithfully.** `cols="200,*"` → `grid-template-columns: 200px 1fr`. A `%` frame → the same `%`/`fr`; `*` is the remaining space. Match the divider thickness (`border`/`framespacing`) with a gutter of the same px.
3. **Each frame is its own region/route.** A frame `src="nav.jsp"` becomes the rebuilt nav component in that grid cell; a frame whose `src` is an action → that screen's component. Independent scroll per frame → `overflow:auto` on the cell.
4. **Reproduce resize behavior.** `noresize` → a fixed track; a resizable frameset → a draggable splitter **only if** the original allowed it (don't add resizing the legacy didn't have).
5. **Verify at every crawled viewport** — frameset geometry is exact, so the visual + computed-style layers will catch a few px of drift.

## Parity gotchas

- A frame with `scrolling="no"` that overflows **clips** content — reproduce the clip, don't add a scrollbar.
- Inter-frame JS (`parent.frames['nav']`) becomes shared React state / context — map the calls.
- `<noframes>` content is dead — ignore it.
