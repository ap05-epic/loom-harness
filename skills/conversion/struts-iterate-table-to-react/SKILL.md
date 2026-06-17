---
name: struts-iterate-table-to-react
description: Convert a Struts <logic:iterate> + <bean:write> JSP table into a React table with identical columns, order, formatting, links, and empty/sort states.
triggers: [logic:iterate, bean:write, table, c:forEach, display:table, grid, list screen]
---

# <logic:iterate> table → React table

A list screen renders rows with `<logic:iterate id="row" name="results">` (or JSTL `<c:forEach>`) and a cell per `<bean:write name="row" property="…"/>`. Rebuild the table column-for-column.

## Procedure

1. **Map the columns in order.** Each `<th>` → a column; each `<bean:write property="x"/>` → that column's cell accessor. Preserve column ORDER and header text exactly (the structural-DOM layer checks column order + labels).
2. **Carry per-cell formatting.** A cell may wrap the value in `<fmt:formatDate>`/`<fmt:formatNumber>` (use [[jstl-date-parity]]), a conditional (`<logic:equal>` → ternary), or a link (`<html:link>` → `<a>` with the same href template).
3. **Reproduce empty + boundary states.** Note what the JSP renders when the collection is empty (often a "no results" row spanning all columns) and any `<logic:greaterThan>` count guards — match them.
4. **Keep sort/pagination semantics.** If header links re-request with a sort param (`?sort=col&dir=asc`), reproduce the same request contract (the behavioral layer replays it). Don't switch to client-side sort if the legacy sorts server-side.
5. **Match row striping + classes.** `<logic:iterate indexId="i">` often alternates a CSS class by `i % 2` — reproduce the exact class names so computed-style passes.

## Parity gotchas

- `<bean:write filter="false"/>` means raw HTML — render it as HTML, not escaped text.
- Nested iterates (a table inside a row) need the same nesting in JSX.
- A column hidden by a role check keeps the same visibility rule.
