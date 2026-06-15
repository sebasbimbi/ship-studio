# BACKLOG — Meno declarative-filter slice

Auto-accepted: all items are low/med risk, one-iteration, non-overlapping files.
Execute in order. Per item: implement → `pnpm check:all && pnpm test:run && pnpm rust:test`
→ `pnpm tauri build` → atomic commit (code only).

| # | Item | Files | Impact | Risk | Status |
|---|---|---|---|---|---|
| 1 | **Pure filter engine.** `matchesFilter(record, filter)` + `applyFilter(records, filter)`: 13 operators, implicit `$eq`, AND across fields, bypass values (`'*'`/`''`/`null`/`undefined`). Exhaustive vitest. | + `src/lib/menoFilter.ts`, + `src/lib/menoFilter.test.ts` | new only | low | done |
| 2 | **Tree-prune adapter (pure).** `filterElementTree(root, query)`: keep a node if `tag`/`cls`/`text` `$contains` query (engine, per-field, OR'd here) **or** it is an ancestor of a match; preserve order + child structure. + vitest. | + `src/lib/elementTreeFilter.ts`, + `src/lib/elementTreeFilter.test.ts` | new only | low | done |
| 3 | **Wire search into the panel.** Search input in `ElementTreePanel` header; active query → render pruned tree + rebuild keyboard-nav index from it; empty query = current behavior byte-for-byte; "No matches" empty state; stay under per-file LOC limit (extract `ElementTreeSearch` row if needed). + test. | ~ `ElementTreePanel.tsx`, + CSS (tree stylesheet), maybe + `ElementTreeSearch.tsx` | additive | med | done |

Item 3 is the only live-component change. If it can't reach green in one iteration or
perturbs keyboard-nav / auto-reveal / selection → `git restore`, mark FAILED, move to
REVIEW_QUEUE. Items 1–2 still ship as a tested foundation.
