# Ship Studio — Review Queue (deferred, NOT executed)

Items the overnight loop deliberately did not execute. Each needs human judgment, exceeds one
iteration, carries higher risk, or fell past the 12-iteration cap. Ordered by recommended priority.

## Auto-acceptable but deferred for budget (do these first next batch)

### A8 — publishing.rs network git ops → `run_with_timeout`
- **What:** `publish_to_github/staging/production/branch` run `git pull --rebase origin` and
  `git push -u origin` via blocking `.output()` (~6 call sites). A hung remote can freeze the UI —
  exactly the failure `run_with_timeout` (60s `GIT_NETWORK_TIMEOUT_SECS`) was built to prevent.
- **Pattern:** mirror `git/branches.rs::run_git_net`.
- **Risk:** med — one file, but 6 call sites; converting blocking→async-timeout needs care.
- **Files:** `src-tauri/src/commands/publishing.rs`

### B3 — AssetsPanel modal shell → `<ModalFrame>`
- **What:** `modal-overlay` + `assets-close-btn` hand-rolled shell → `<ModalFrame>`; preserve the
  many inner `stopPropagation` row handlers.
- **Risk:** med (M effort) — body has nested stopPropagation that must survive the migration.
- **Files:** `src/components/workspace/AssetsPanel.tsx`

## Rejected during execution (judgment call, not a failure)

### #11 — Memoize per-render `.reduce()` math (DECLINED)
- Sites: `WorkspaceView.tsx` split-pane percent, `TerminalSplitHeaders.tsx` cumulative
  percent, `ConflictResolutionModal.tsx` conflict counts.
- All three reduce over tiny arrays (2-4 panes; a handful of conflict files). `useMemo`'s
  dependency-comparison overhead is comparable to the sum it would cache, so there is no
  measurable perf win — only added deps surface and stale-closure risk. Declined as
  cargo-cult memoization. Revisit only if a pane/conflict count ever grows large.

## Higher-risk / non-atomic (need a human call)

### D2 — Stabilize ProjectCard callback chain so `memo` engages
- `ProjectCard`/`FolderCard` are `memo`'d but receive fresh inline arrows each render, defeating it.
  Fixing only the leaf gives no benefit — needs `useCallback` stabilization up through
  `ProjectGridView` → `ProjectList` → `ProjectsView`/`App.tsx`. Multi-file, med risk, overlaps #12.

### D6 — Vite `manualChunks` vendor split
- No `rollupOptions.output.manualChunks`; `chunkSizeWarningLimit` was raised to 1000 (a tell).
  Splitting react/xterm/shiki into named chunks is a known build-perf win but needs `pnpm build`
  chunk-graph verification. Med risk.

### D7 — Lazy-load xterm terminal components
- `React.lazy` the 4 xterm-importing components to drop the WebGL/xterm chunk from the dashboard
  critical path. **High risk:** xterm init + WebGL addon + the CSP-null font gotcha only break in
  `pnpm tauri build` (not dev) — needs a production-build smoke test.

## Broad sweeps (multi-PR, split per-domain)

- **onToast prop chains → `useOptionalToast()`** — 136 refs across 19 files. Migrate per-domain.
- **`String(e)` catches → `formatCommandError(asCommandError(e))`** — 174 sites; only 7 files use
  the helpers today. Broad.
- **`formatRelativeTime` consolidation** (health.ts/support.ts/branches.ts) — variants emit
  different strings ("5 minutes ago" vs "5m ago") + different input types. Needs a format decision.
- **byte formatters** `formatFileSize` (assets.ts) + `formatSize` (CodeViewer.tsx) — different
  rounding/units; not a pure drop-in.
- **`setInterval` → `usePolling`** in UpdateBanner/CreateProject — immediate-fire + backoff
  semantics differ; behavior change.
