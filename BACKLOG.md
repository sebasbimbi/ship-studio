# Ship Studio — Overnight Improvement Backlog

Generated from a 4-axis read-only analysis swarm (architecture, code-health, test-coverage, perf/DX).
Baseline at start: **green** (`check:all` ✓, 698 vitest ✓, 395 rust ✓) and **buildable** (compiles + bundles `.app`/`.dmg`; `tauri build` exits 1 only on missing `TAURI_SIGNING_PRIVATE_KEY`, a publishing secret out of scope).

Branch: `feat/redline-visual-editor`. Single serialized writer. Per-item gate = green + `pnpm build` (compile proof).

## Auto-accepted (executed in order)

| # | Improvement | Axis | Impact | Effort | Risk | Files |
|---|---|---|---|---|---|---|
| 1 | Add Rust unit tests for `parse_conflicts` + `images_are_similar` | C | high | S | low | `src-tauri/src/commands/conflicts.rs`, `src-tauri/src/commands/ide/screenshots/stitch.rs` |
| 2 | Add command-palette unit tests: `scoreMatch`, `frecencyBoost`/`recordRun`, registry `setBucket`/`getSnapshot`/`subscribe` | C | high | S | low | new `src/commands/{score,frecency,registry}.test.ts` |
| 3 | Add lib-helper unit tests: `errors.ts`, `projectIdentity.ts`, `ansi.ts`, `static-server.ts` | C | high | S | low | new `src/lib/{errors,projectIdentity,ansi,static-server}.test.ts` |
| 4 | Add color-helper unit tests: `toFormat`, `visibleHex`, `toHex`, `toRgba`, `rgbaToCss`, `toCss` | C | med | M | low | new `src/lib/color.test.ts` |
| 5 | Add `#[tracing::instrument]` to uninstrumented PTY + snapshot commands | A | med | S | low | `src-tauri/src/commands/pty_session.rs`, `pty/stream.rs`, `pty/mod.rs`, `pty/spawn.rs`, `snapshots.rs` |
| 6 | Surface `pending_stash_from` + `stash_applied` in `switchBranch` (SwitchResult type drift) | A | high | S | low | `src/lib/branches.ts` |
| 7 | Route raw `invoke()` through lib wrappers: `get_screenshot_base64`, `get_shell_path`, `get_system_env` | A | med | S | low | `src/lib/ide.ts`, `src/components/preview/ScreenshotPreview.tsx`, `src/lib/project.ts`, `src/components/terminal/Terminal.tsx`, `src/components/setup/OnboardingTerminal.tsx` |
| 8 | Use existing `setTerminalState()` wrapper instead of raw `invoke('set_terminal_state')` | A | med | S | low | `src/App.tsx` |
| 9 | Convert `ImportTypePicker` hand-rolled overlay to `<ModalFrame>` (gains ESC + a11y close) | B | high | S | low | `src/components/dashboard/ImportTypePicker.tsx` |
| 10 | Convert `GitHubButton` Create-Repo modal overlay to `<ModalFrame>` | B | med | S | low | `src/components/branches/GitHubButton.tsx` |
| 11 | Memoize per-render `.reduce()` math in split panes + conflict modal | D | low | S | low | `src/components/workspace/WorkspaceView.tsx`, `src/components/workspace/TerminalSplitHeaders.tsx`, `src/components/branches/ConflictResolutionModal.tsx` |
| 12 | Remove dead `searchQuery` state in `ProjectList` (setter never called; search moved to Cmd+K) | D | low | S | low | `src/components/dashboard/ProjectList.tsx` |

## Deferred → REVIEW_QUEUE.md (auto-acceptable but over the 12-iteration cap, or higher-risk/non-atomic)

- A8 publishing.rs blocking git net ops → `run_with_timeout` (med risk, multi-call-site) — **strong next-batch candidate**
- B3 AssetsPanel modal shell → `<ModalFrame>` (med effort, preserve inner stopPropagation) — **strong next-batch candidate**
- D2 stabilize ProjectCard callback chain so `memo` engages (med risk, multi-file, overlaps #12)
- D6 Vite `manualChunks` vendor split (med risk, build-graph change)
- D7 xterm lazy-load (high risk; CSP/font prod gotcha)
- onToast prop chains → `useOptionalToast()` (136 refs / 19 files; per-domain multi-PR)
- `String(e)` catches → `formatCommandError(asCommandError(e))` (174 sites; broad sweep)
- `formatRelativeTime` consolidation (changes user-visible strings; needs format decision)
- byte formatters `formatFileSize`/`formatSize` consolidation (different rounding/units)
- `setInterval` → `usePolling` in UpdateBanner/CreateProject (immediate-fire semantics differ)
