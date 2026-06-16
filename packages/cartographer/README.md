# @loom/cartographer

The **MAP** stage: parse undocumented legacy source into a queryable graph — the **CodeAtlas** — and a compact, graph-ranked overview the agents can read whole.

For a Struts/JSP/Tiles app, off-the-shelf tools recover none of the screen semantics, so the cartographer ships dependency-free custom parsers plus a SQLite graph.

## Parsers

Each is pure (string → structured model) and verified against the fixture's authentic legacy source:

- **`parseStrutsConfig`** — actions, form beans, forwards (the screen graph).
- **`parseJsp`** — taglibs, includes, Struts forms + their fields (select options too), navigation links, and `logic:iterate` table bindings.
- **`parseTilesDefs`** — the Tiles layout composition (definitions, `extends`, the header/footer/body JSPs).
- **`parseWebXml`** — servlets/filters joined to their `url-pattern` mappings.

## The CodeAtlas

A SQLite graph (`ca_nodes` / `ca_edges`). `ingestLegacyWebapp` wires every parser into one graph:

- **nodes**: `action`, `form_bean`, `jsp` (with parsed forms in meta), `taglib`, `tile_def`, `servlet`, `filter`.
- **edges**: `renders`, `uses_form`, `forwards_to`, `extends_tile`, `uses_taglib`, `includes`, `links_to`, `submits_to`.

Ingest is idempotent (`ensureNode` + `setNodeMeta`), so re-mapping never double-counts. `screens()` and `sliceForScreen(key)` give per-screen views — the slice now surfaces the screen's forms + taglibs for the Builder.

## The repo-map

**`repoMap(atlas, { project })`** renders a compact, **PageRank-ranked** overview that names every screen with its action, view JSPs, forms, and navigation — the cheap whole-codebase context tier (the fixture map is well under an 8K-token budget). Importance ranking means a budgeted slice keeps the most-connected screens.

## Discovery

**`discoverLegacyWebapp(strutsConfigPath)`** finds the sibling `tiles-defs.xml` / `web.xml` and every `*.jsp` under the webapp root, so a single `loom map` builds the full enriched atlas from one config path.

## Search

**`atlas.search(term)`** — FTS5 full-text search (BM25-ranked) over node names, kinds, **and generated docs**, with a LIKE fallback when FTS5 isn't compiled in. The on-demand "find" tier; FTS5 is present in the `node:sqlite` backend the pod uses.

## Generated documentation

**`summarizeScreens(atlas, { gateway, model })`** is how MAP recovers the _missing documentation_: one grounded LLM completion per screen (from its slice — action, forms+fields, navigation) produces a short description stored on the action node (`setNodeDoc`/`getNodeDoc`). The docs are human-reviewable, searchable, and surface in the repo-map. Use a cheap model (the Summarizer role).

## CLI

- `loom map` — build the enriched atlas (auto-discovers Tiles/web.xml/JSPs).
- `loom atlas repomap` — print the whole-app overview.
- `loom atlas slice <screen>` — one screen's action / form bean / JSPs / forms / taglibs.
- `loom atlas find <term>` — search the atlas.
- `loom atlas summarize` — run the LLM docs pass (writes a summary per screen).

## Tested

61 tests: each parser against the real fixture files, the enriched ingest graph (Tiles composition, web.xml, JSP enrichment, idempotency), the repo-map (names all screens, token budget, ranking), FTS5 search, and discovery.

Still to come (M3 continued): tree-sitter Java parsing, the sqlite-vec semantic tier, incremental re-index, and the `codeatlas` MCP server.
