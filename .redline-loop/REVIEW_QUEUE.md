# REVIEW_QUEUE — deferred, NOT executed by the loop

Each needs an explicit human decision (scope, risk, deps, or breaking change).

## Scope expansions (A/B)
- **Option A — native Meno authoring mode.** Adopt Meno's JSON node tree + compile-to-HTML
  as a new authoring surface. Inverts source-of-truth; very large; competes with the framework.
- **Option B — replace the static-analysis editor** with a Meno-style JSON editor. Would
  break the proxy editor + "works with any framework config".

## Rejected C variants
- **`{{...}}` template-expression engine.** Public grammar is under-documented (operators /
  conditionals omitted) and Ship Studio has no Meno data context to evaluate against. Revisit
  only if a concrete consumer + the full grammar appear.
- **Read-only JSON-node renderer.** Reimplements Meno's 7 node types + responsive styles +
  component registry — reimplementation, not a borrow.

## Filter capability — parts intentionally left out of the slice (YAGNI / coupling)
- **Sort** (`filter.sort(field, dir)`) — no consumer yet (the element tree is order-preserving).
- **Pagination** (`setPerPage` / `setPage` / `getPageInfo`) — no consumer yet.
- **URL-sync** (`data-meno-url-sync`) — Meno-runtime concept; no router hook here.
- **`data-meno-*` DOM attribute layer + `MenoFilter` JS runtime/event API** — Meno-DOM-coupled;
  Ship Studio uses React state, not DOM-attribute wiring.

## Deferred from adversarial review (workflow wsyai3pv8) — confirmed but out-of-slice / enhancement
- **#5 (med) — clear `selectedId` on `treeDirty` when the new tree no longer contains it.** Fix lives in `src/hooks/useElementTree.ts` (outside this slice) and is a pre-existing behavior (selection comes from the iframe, independent of the snapshot). The panel-side dead-nav symptom is already handled by the committed nav-resilience fix (`36cf9ac`). Revisit when touching `useElementTree`.
- **#6 (med) — a row can match on a class it doesn't display.** Rows render only the first class (`RowLabel`), but search matches the full class string, so a hit on a non-first class looks unexplained. Enhancement: when filtering, render the matched/all classes or highlight the matched field. Deferred — it changes the established compact row rendering; not a correctness bug.
- **Pre-existing latent assumption (related to #2):** `RowLabel` does `node.cls.split(...)` and `useElementTree.mapNode` passes wire fields through without coercion. The committed fix hardened the new filter path; hardening these other consumers (or coercing at the `mapNode` boundary) is a separate, pre-existing cleanup.
- **Stale comment (noted in passing):** `BrowserTools.tsx` says "1500-node cap" while the select script uses `TREE_MAX_NODES=4000`. Doc-only, out of slice.

## Out of scope per brief
- Any backend / Tauri command for this slice (kept frontend-only by design).
- Publishing / deploys / GitHub / auth / telemetry.
- New dependencies.
- Meno CMS, cms-fields, component-props, i18n model (i18n already solved here).
