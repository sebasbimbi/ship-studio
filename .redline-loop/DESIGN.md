# DESIGN — Borrowing a Meno capability into the Ship Studio visual editor

Branch: `feat/redline-visual-editor` · Date: 2026-06-15

## The tension (named)

Meno's JSON **node tree is the source of truth**, compiled to HTML. Ship Studio is the
**inverse**: a visual layer over a **real framework dev server** (Next.js / Astro / Vite /
Liquid …) via a reverse **proxy + iframe**. In Ship Studio the framework's **source files**
are the source of truth; rendered HTML comes from the running dev server; the editor works
by **static analysis** (indexing `className`/text/`src` string literals and surgically
rewriting them — `src-tauri/src/commands/edit.rs`), never by owning a document model.

Consequence: any Meno capability that assumes "the document model is mine to render or
compile" is a non-fit. Only a **pure, data-in → data-out capability** with no
document-model assumptions is safely borrowable.

## Scope decision — A / B / C

| Option | Description | Decision | Reason |
|---|---|---|---|
| **A** — new native authoring mode | Adopt Meno's node tree + compile-to-HTML as a new way to author pages | **Rejected** | Inverts our source-of-truth model; enormous surface; competes with the framework. Out of scope. |
| **B** — replace part of the editor | Swap our static-analysis editor for a Meno-style JSON editor | **Rejected** | Would break the existing proxy editor and the "works with any framework config" guarantee. |
| **C** — borrow a specific capability | Lift one pure, self-contained slice and give it a real home | **CHOSEN** | Most conservative viable option; honors the loop's "unattended + don't break anything" constraints. |

## Capability decision (within C)

The brief named two example candidates. After reading the Meno docs I selected a third,
better-fitting one. Reasoning:

| Candidate | Self-contained | Fully specified | Real home in Ship Studio | Decision |
|---|---|---|---|---|
| `{{...}}` template engine (named default) | Yes (string→value evaluator) | **No** — public docs show property-access only and omit operators / conditionals / filters; real grammar is hidden → high risk of building the wrong thing | **No** — Ship Studio has no Meno data context to evaluate against | Rejected |
| Read-only JSON-node renderer (named alt) | Only by reimplementing all 7 node types + responsive styles + a component registry | n/a | No — this is *reimplementing* Meno, not borrowing | Rejected |
| **`meno-filter-api`** (chosen) | **Yes — pure data-in→data-out** | **Yes — exact operator set + object shape documented** | **Yes — the element tree on this branch has no search** | **CHOSEN** |

`meno-filter-api` is the single cleanest liftable spec (independently ranked #1 by two doc
reviews): a pure declarative filter. It is fully documented (reliable green), trivially
unit-testable (the loop's verify gate), and has **zero coupling** to the proxy / edit-commit /
framework-detection paths (cannot break the existing editor or other-framework support).

### Borrowed spec (https://meno.so/docs/meno-filter-api)

- **Operators:** `$eq, $neq, $gt, $gte, $lt, $lte, $contains, $notContains, $startsWith,
  $endsWith, $in, $nin, $empty`.
- **Filter object:** `{ field: value }` (implicit `$eq`) or `{ field: { $op: value } }`.
  Multiple fields combine with **AND**. Special **bypass** values — `'*'`, `''`, `null`,
  `undefined` — mean "no constraint on this field" (match everything).
- **Not borrowed** (deferred → REVIEW_QUEUE): the `data-meno-*` DOM-attribute layer, the
  `MenoFilter` JS runtime/event API, URL-sync, **sort**, **pagination** — Meno-DOM-coupled
  and/or no consumer here (YAGNI). We implement only the filter/match core the consumer uses.

## The consumer (so the capability is not dead code)

`src/components/edit/ElementTreePanel.tsx` — the redline Webflow-style element tree (this
branch's feature). Today: read-only navigator, arrow-key nav, **no text search**. Nodes are
`ElementTreeNode = { id, tag, cls, text, children }` (from `src/hooks/useElementTree`).
A search box backed by the borrowed engine is **additive**, on-brand, and touches no
edit-commit / proxy code.

## Subsystem map

| Meno subsystem | Source doc | Exists here? | Net-new for this slice | Risk |
|---|---|---|---|---|
| Declarative filter operators | meno-filter-api | No | `src/lib/menoFilter.ts` (pure) | low |
| List/collection iteration | lists | No (N/A — no doc model) | — (not borrowed) | — |
| `{{...}}` template eval | template-expressions | No (static analysis only; intentional) | — (rejected) | — |
| Node-tree renderer | node-types | No (dev server renders) | — (rejected) | — |
| CMS / fields / i18n / component-props | cms*, internationalization | i18n already solved differently | — (not borrowed) | — |
| Filter UI over a list | filtering-and-search | element tree has none | `ElementTreePanel` search box | med |

## Layer mapping for the chosen slice

| Layer | Touched | What |
|---|---|---|
| Tauri command (`src-tauri`) | **No** (intentional) | Element tree is client-side DOM → no backend needed; no `lib.rs` registration, no new Rust surface. Rust stays green/built, untouched. |
| `src/lib` pure modules | Yes | `menoFilter.ts` (engine) + `elementTreeFilter.ts` (tree-prune adapter) |
| Visual editor component | Yes | `ElementTreePanel.tsx` search input |
| Preview / proxy | **No** | Untouched. |
