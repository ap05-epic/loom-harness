# Struts → React conversion skills

A bundled pack of `SKILL.md` conversion skills — reusable migration knowledge for taking a Struts 1.x / JSP / Tiles app to React, with the parity gotchas that catch people out. They're written to be recalled by the Builder/Fixer when a screen matches their triggers (a Tiles layout, a date format, a `<logic:iterate>` table, a frameset, a menu shell, a dense form).

| Skill                           | When it fires                                              |
| ------------------------------- | ---------------------------------------------------------- |
| `tiles-layout-to-react`         | Tiles definitions / `<tiles:insert>` → a layout component  |
| `jstl-date-parity`              | `<fmt:formatDate>` / `SimpleDateFormat` → exact JS dates   |
| `struts-iterate-table-to-react` | `<logic:iterate>` + `<bean:write>` → a React table         |
| `frameset-to-react-geometry`    | `<frameset>` / `<iframe>` → CSS layout, identical geometry |
| `menu-nav-shell`                | a `qpmenu`-style dispatcher with no stable URLs            |
| `large-screen-decomposition`    | a screen with 50+ controls — decompose without loss        |

## Using them

Load the pack into a project's skill store so the agent recalls them during a run:

```bash
loom skills load --from skills/conversion --data-dir ~/loom-data/<project>
```

`load` registers each SKILL.md into the project's store as an **active bundled** skill. The relevance-ranked recall then surfaces the right one into each screen's work order (matched on name/description/triggers), and the Reflector **compounds** them — drafting project-specific refinements that, after a few proven reuses, auto-promote alongside these. See [Skills & memory](../../docs/concepts/skills-and-memory.md).

> `loom skills load` registers into the recall store (the DB); `loom skills import` is the separate file-copy path for DIGIT/`~/.copilot` interop.

> These are generic Struts→React knowledge (reusable for any such migration). Anything app-specific (selectors, the real menu tree, deployment quirks) belongs in the project's own skills, not here.
