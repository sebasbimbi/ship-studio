# Ship Studio — Overnight Loop Progress

Format: `<hash> · #<id> · <type> · <desc> · <time>`

Baseline: green + buildable confirmed before first item.

f60d2ab · #1 · test · cover parse_conflicts + images_are_similar (10 Rust tests) · green+build ok

2e793b0 · #2 · test · palette scorer + frecency + registry (20 vitest) · green+build ok
e10805c · #3 · test · errors + projectIdentity + ansi + static-server (17 vitest) · green+build ok
564bb5b · #4 · test · color helpers toHex/toRgba/toFormat (15 vitest) · green+build ok
4f33a5e · #5 · refactor · tracing::instrument on 22 PTY commands · green+build ok
58f907f · #6 · fix · surface pending_stash_from + stash_applied in switchBranch · green+build ok
d3079f7 · #7 · refactor · lib wrappers for screenshot/shell/env invoke calls · green+build ok
96d7ee0 · #8 · refactor · use setTerminalState wrapper in App.tsx · green+build ok
39621aa · #9 · refactor · ImportTypePicker -> ModalFrame (ESC + a11y close) · green+build ok
e59e278 · #10 · refactor · GitHubButton create-repo modal -> ModalFrame · green+build ok
d2c52fa · #12 · refactor · drop dead searchQuery useState in ProjectList · green+build ok
(skipped) · #11 · perf · memoize tiny reduce() — DECLINED as cargo-cult memoization (see REVIEW_QUEUE)

DONE · 11 commits green+built · final: check:all OK · 750 vitest · 405 rust · tauri build compiles+bundles (signing-only gap)
