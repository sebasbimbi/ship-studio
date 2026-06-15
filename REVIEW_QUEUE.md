# Ship Studio — Review Queue (deferred, NOT executed)

Items the overnight loop deliberately did not execute. Each needs human judgment, exceeds one
iteration, carries higher risk, or fell past the 12-iteration cap. Ordered by recommended priority.

## Auto-acceptable but deferred for budget (do these first next batch)

### A8 — publishing.rs network git ops → `run_with_timeout`  ✓ DONE (batch 2, 3a8abce)
- Converted the 5 network git ops (1 `pull --rebase` + 4 `push`) to a `run_git_net` helper (60s),
  mirroring `git/branches.rs`. Same blocking-network class also fixed this batch:
  `pull_requests.rs` gh/git ops via `run_net` (2aa1891) and `ai.rs` git context gathering via
  `run_with_timeout` (b665ab8).

### B3 — AssetsPanel modal shell → `<ModalFrame>`  (still deferred — batch 2 re-confirmed)
- **What:** `modal-overlay` + `assets-close-btn` hand-rolled shell → `<ModalFrame>`.
- **Why still deferred:** not a drop-in. It is multi-file and visually behaviour-changing: the
  `.assets-panel-modal` sizing CSS currently targets `.modal .assets-panel-modal` and would need
  re-pointing to `.modal-frame-content`; the custom `.assets-panel-header` (h3 + close) gets
  replaced by ModalFrame's own header (different padding/title/close styling); and ModalFrame's
  base `.modal-frame-content` padding can fight `.assets-panel-content`. None of this is verifiable
  by `check:all`/tests — it needs a visual/`tauri build` smoke test. The inner row
  `stopPropagation` handlers are unrelated to the overlay and survive untouched.
- **Risk:** med (M effort) — do as a focused PR with a visual check.
- **Files:** `src/components/workspace/AssetsPanel.tsx`, `src/styles/features/assets-panel.css`

## Rejected during execution (judgment call, not a failure)

### #11 — Memoize per-render `.reduce()` math (DECLINED)
- Sites: `WorkspaceView.tsx` split-pane percent, `TerminalSplitHeaders.tsx` cumulative
  percent, `ConflictResolutionModal.tsx` conflict counts.
- All three reduce over tiny arrays (2-4 panes; a handful of conflict files). `useMemo`'s
  dependency-comparison overhead is comparable to the sum it would cache, so there is no
  measurable perf win — only added deps surface and stale-closure risk. Declined as
  cargo-cult memoization. Revisit only if a pane/conflict count ever grows large.

### Batch-2 hunt — DECLINED (no real benefit / wrong direction)
- **claude.rs version parse `unwrap_or(0)` → `filter_map(ok)`** — Claude app version dirs are
  well-formed `vX.Y.Z`; the malformed-suffix case is hypothetical and the change only shuffles
  sort order for inputs that don't occur. No real benefit, adds edge-case risk (cargo-cult).
- **`git/mod.rs` `(*name).to_string()` "clone overhead"** — false perf claim: `(*name).to_string()`
  and `name.to_string()` both allocate exactly one `String`. Not a finding.
- **`proxy/html.rs` manual escaping → `html_escape` crate** — wrong direction for a ponytail pass:
  adds a dependency for ~5 string replacements. The hand-rolled escaping is clear and dep-free; keep.
- **`useAssetManagement.handleCopyPath` raw clipboard → `useCopyToClipboard`** — not a clean
  drop-in: the panel needs PER-PATH copied state (`copiedPath === asset.path`), but the hook exposes
  a single `isCopied` boolean. Converting would regress the per-row copied indicator.
- **`Preview.tsx` `refresh()` setTimeout cleanup** — already guarded (`if (iframeRef.current)`); the
  100ms timer no-ops after unmount and re-sets the same URL. Harmless; not worth restructuring.

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

### D8 — Consolidate the per-module git/net timeout helpers (multi-file)
- `run_git_net` is now copied across `git/branches.rs`, `git/status.rs`, `git/sync.rs`,
  `publishing.rs`, plus the generic `run_net` in `pull_requests.rs` and `ai.rs`'s inline calls —
  all the same shape (build Command → `tokio::process::Command::from` → `run_with_timeout`, 60s).
  Extract one shared helper (e.g. `external_command::run_net(cmd, label, secs)` or a git-specific
  wrapper in `commands/git/mod.rs`) and replace the copies. Low risk but multi-file → its own PR.

### D9 — snapshots.rs `capture_snapshot().unwrap_or_default()` swallows git errors
- `snapshot_start_watching` (snapshots.rs:379) seeds history with an empty SHA when the initial
  `capture_snapshot` fails, so a non-git/corrupt repo silently gets a broken undo state. Judgment
  call: is an empty initial SHA ever valid, or should it fail fast (`?`) / at least `warn!`? Needs a
  decision on snapshot semantics for non-git projects before changing control flow.

### D10 — static_server.rs `resolve_file_path` TOCTOU (security)
- `is_file()` is checked (line ~421) before `dunce::canonicalize()` (~424); a file swapped for a
  symlink in that window could dodge the order. The subsequent `starts_with(project_root)` check
  still guards traversal, so real risk is low, but the ordering should be canonicalize → contains
  check → is_file. Security-sensitive: review carefully, don't rush.

### D11 — code.rs `should_skip_path` substring matching (behaviour-changing)
- Does `== / starts_with / contains "/X/" / ends_with "/X"` per skip dir, which false-positives
  (e.g. `react` matching `my-react-component`). Switching to `Path::components()` + a `HashSet`
  lookup is cleaner AND more correct, but it CHANGES which files the code tree skips — needs a
  conscious behaviour sign-off (and ideally a fixture test).

### D12 — usePreviewResize drag listeners leak if unmounted mid-drag
- `handleResizeStart`/`handleVerticalResizeStart` add `document` mousemove/mouseup listeners that
  are only removed in their own `mouseup`; unmounting during an active drag leaks them (they no-op
  via ref guards but persist on `document`). Low impact, but the fix restructures the drag lifecycle
  into a `useEffect` with cleanup tracking the in-flight drag — med risk, not a one-liner.

### D13 — Frontend one-shot setTimeout cleanups (low priority cluster)
- `ScreenshotPreview.tsx` inner `setTimeout(onDismiss, 300)` and `OnboardingTerminal.tsx`
  `setTimeout(fit, 0)` aren't cleared on unmount, so a late callback can fire post-unmount (React
  "set state on unmounted" warnings; `fit()` on a disposed addon). Each is a small, isolated
  ref+clear fix; batch them in one frontend pass.

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
