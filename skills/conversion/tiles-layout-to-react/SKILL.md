---
name: tiles-layout-to-react
description: Convert a Struts Tiles layout (tiles-defs.xml definitions + <tiles:insert>) into a React layout component with identical regions, nesting, and geometry.
triggers: [tiles, tiles-def, layout, tiles:insert, putAttribute, baseLayout]
---

# Tiles layout → React layout component

Struts Tiles composes a page from a **definition** (in `tiles-defs.xml`) that names a base JSP layout and fills named regions (`<tiles:put name="header" …/>`). Rebuild this as a React layout component whose props are the regions.

## Procedure

1. **Read the definition graph.** Resolve the screen's tile definition and any `extends` parent. List every `put`/`putAttribute` (region name → JSP or value). The CodeAtlas has this — `loom atlas slice <screen>`.
2. **Find the base layout JSP.** The `path` of the (root) definition is the layout JSP (e.g. `/layout/main.jsp`). Its structure (header/nav/body/footer wrappers + their CSS) is the React layout's JSX skeleton — match the DOM order and class names exactly (the evaluator compares structure + computed style).
3. **Make regions props/children.** Each named region becomes a prop (`<MainLayout header={…} nav={…}>{body}</MainLayout>`) or a slot. A region whose value is a nested definition → a nested layout component.
4. **Carry page-specific overrides.** A screen usually overrides one region (e.g. `title`, `body`); those become the props the screen passes — everything else inherits the definition's defaults.
5. **Preserve geometry + ids.** Keep the wrapper ids/classes the legacy CSS targets, or the computed-style layer fails. Don't "improve" the markup.

## Parity gotchas

- A `<tiles:insert>` with `flush="true"` is visually a no-op — ignore it.
- A region can be a **string** (a title), not a JSP — render it as text, not a component.
- Inherited regions from a parent definition are easy to miss; walk the `extends` chain fully.
