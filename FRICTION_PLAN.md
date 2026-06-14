# FRICTION_PLAN.md — Ship Studio first-run journey

**Scope.** The first-run journey for a non-CLI freelancer/designer (lives in Figma/Webflow; never used a terminal, git CLI, package manager, or an AI coding agent): app launch → prereqs installed → accounts connected → first project → first agent run + live preview. Plus the pinned build items in PART C (file-tree drag-and-drop), which ship regardless of the friction ranking.

**Method.** Four read-only subagents, one per first-run stage, traced the real flow through the persona's eyes and returned friction points with file/function/UI-step citations. Synthesized here. Every row cites concrete evidence.

**Persona quit-triggers** (the lenses every finding is judged against): scary jargon ("PATH", "CLI", "auth token", "PTY"), dead-ends with no obvious next step, raw black terminals ("I'm in the wrong app"), and actions that give no feedback (looks hung → force-quit).

---

## PART A — Friction table

Ranked by **score = Impact × (1/Effort)** where Impact {High=3, Med=2, Low=1}, Effort {S=1, M=2, L=3}. Higher score = cheaper, higher-leverage = do sooner. **Top 3 flagged ★ DO FIRST.**

| # | Stage | Friction (short) | Evidence | Fix (short) | Eff | Imp | Score |
|---|-------|------------------|----------|-------------|-----|-----|-------|
| **F1 ★** | 1 Launch→prereqs | First click ("Install" on Package Manager) opens a raw black xterm running `curl\|bash` Homebrew that may prompt for the Mac password — reads as malware, no reassurance | `setup.ts:573-596,648-660`; `OnboardingScreen.tsx:586-605`; `OnboardingTerminal.tsx:90-120` | Reassurance banner in `.onboarding-terminal-header` when `itemId==='homebrew'` (password prompt is expected/safe) | S | High | **3.0** |
| **F9 ★** | 2 Prereqs→accounts | Friendly plain-language auth copy ("A code was copied to your clipboard, paste it in the browser") already exists but is **dead code** — wizard routes auth through the raw terminal instead | `auth.rs:58,110-113`; `setup.ts:388,404` (no callers); raw path `OnboardingScreen.tsx:312-321` | Call `startGitHubAuth`/`startClaudeAuth` wrappers from `handleItemAction` for `*_auth`; render returned message in a ModalFrame + Spinner + poll status | S | High | **3.0** |
| **F6 ★** | 1 Launch→prereqs | Very first words the persona reads are jargon with no WHY ("Package Manager & Node.js", "Fix npm Permissions") → "wrong app" anxiety | `setup.ts:298-305` (step subtitle), `155-170` (`SETUP_FRIENDLY_NAMES`) | Rewrite step subtitle to plain purpose ("free one-time setup so your AI can build/run your site"); rename "Fix npm Permissions" → non-alarming | S | Med | 2.0 |
| F2 | 1 | Blocked "Node.js" row shows "Waiting for Package Manager" + no button → reads as broken/dead-end | `PackageManagerStep.tsx:33-35`; `SetupItem.tsx:142-144` | Reword blocked copy to "Installs automatically after Package Manager"; de-emphasize | S | Med | 2.0 |
| F4 | 1 | Disabled "Next" gives no reason → freeze | `OnboardingScreen.tsx:466-480,577-583` | Helper line naming the gating item ("Finish installing Node.js to continue") | S | Med | 2.0 |
| F12 | 2 | No explanation of what each connection unlocks / which are optional | `setup.ts:307-309,320-326`; dead `isOptional`/`onSkip` in `SetupItem.tsx:194-216` | One-line "what this unlocks (required/optional)" under each step header; wire or delete the dead optional affordance | S | Med | 2.0 |
| F13 | 2 | Item names "GitHub CLI", "Vercel CLI", "Codex", "Opencode" are scary/meaningless | `setup.ts:155-170`; `AgentStep.tsx:69-71` | Rename to human terms + one-line agent descriptions | S | Med | 2.0 |
| F21 | 3 | Community-template "Continue" download fails **silently** (only `logger.error`) | `CreateProject.tsx:134-150` | Surface failure via existing toast/`setError` ("Couldn't download — check connection") | S | Med | 2.0 |
| F25 | 4 | Dev-server "Could not connect" wait shows "Attempt 24/60" (reads as broken); recovery "Fix with agent" can be missing for static projects | `usePreviewConnection.ts:21,339-345`; `DevServerStatus.tsx:141-172`; `Preview.tsx:746-764` | Calmer warm-up copy until ~attempt 15; make "Fix with agent" primary + always present | S | Med | 2.0 |
| F27 | 4 | No in-pane "Agent is working…" signal; screenshot→agent loop unexplained | `Terminal.tsx:395-438`; `WorkspaceView.tsx:1329-1363` | Inline Spinner + "Agent is working…" in terminal header from existing `AgentStatus`; rely on tour for the screenshot loop | S | Med | 2.0 |
| F3 | 1 | Node/Git/gh install runs **silently** (no streamed output) for a multi-minute op; no timeout → "hung" panic | `OnboardingScreen.tsx:324-343`; `install.rs:190-194` (bare `.output()`, no timeout) | Stream brew output to the existing OnboardingTerminal (or emit `setup-progress`); wrap in `run_with_timeout` | M | High | 1.5 |
| F8 | 2 | GitHub/agent auth dumps user into a raw interactive CLI menu (arrow-key navigation) | `OnboardingScreen.tsx:312-321`; `setup.ts:604-607,648-660` | Same as F9 (browser-poll modal); keep terminal as power-user fallback | M | High | 1.5 |
| F10 | 2 | Agent "Connect" runs bare `claude` → boots the full agent TUI, not a login | `setup.ts:538-541,612-615` | Use `start_claude_auth` (`auth.rs:65`) behind the browser-poll modal | M | High | 1.5 |
| F15 | 3 | Zero-projects dashboard = wall of dev chrome (agents/integrations/GitHub calendar); empty state has **no action button** | `ProjectList.tsx:515-667`; `ProjectGridView.tsx:75-79` (no `action` prop) | Pass a "+ Create your first project" Button into the empty `EmptyState`; gate dev chrome behind `projects.length>0` | M | High | 1.5 |
| F16 | 3 | 10-tile template grid (Next/Astro/Nuxt/Expo/Blank…) with no Recommended marker, no grouping, jargon descriptions → paralysis | `useProjectCreation.ts:62-69,72-136`; `CreateProject.tsx:269-302` | "Recommended" pill on default tile; group Websites/Mobile/Other; rewrite descriptions in designer language | M | High | 1.5 |
| F22 | 4 | Agent terminal (the AI builder) has zero instruction; starts dimmed/grayscale → reads as disabled/scary | `Terminal.tsx:957-1004` (dim overlay, no copy) | First-run hint over the dim scrim ("Click here, type what you want to build, press Enter"), gated on a localStorage flag | M | High | 1.5 |
| F23 | 4 | Learn Mode (the only built-in explainer, full of designer-friendly copy) is reachable **only via Cmd+K** and never auto-launches | `useAppCommands.tsx:319-325`; `educationContent.ts:262-266`; no toolbar button | Auto-run a guided tour on first workspace open (localStorage flag) + a visible GraduationCap toolbar button → **this is the PART B tour** | M | High | 1.5 |
| F5 | 1 | Install-failure messaging is terse raw stderr; only "Retry" (fails again) + Slack | `OnboardingScreen.tsx:236-248`; `install.rs:196-203`; `SetupItem.tsx:161-174` | Map common brew errors to plain language; add secondary "Get help" (Slack/troubleshooting ModalFrame) | M | Med | 1.0 |
| F11 | 2 | Abandoned/timed-out browser auth → vague "Authentication not completed" dead-end, no diagnosis | `OnboardingScreen.tsx:213-232,262-271` | Actionable error copy + reuse existing Slack CTA; inline "auth is the blocker" near disabled Next | M | Med | 1.0 |
| F17 | 3 | git clone / npm install failure shows raw "Process exited with code N" + 30 lines stderr + "run sudo … in a terminal" (impossible for persona) | `useProjectCreation.ts:271-302`; `CreateProject.tsx:205-221`; dup in `ImportProject.tsx:168-182` | Backend fix command for known codes (no sudo line); collapse raw stderr behind "Show details"; plain lead copy | L | High | 1.0 |
| F18 | 3 | Multi-minute clone+install with static "This may take a minute", no live signal → "hung" | `useProjectCreation.ts:153-158,305-326,252-262` | Lift the latest pty-output line into the status area; escalating "still working" sub-line after ~30s | M | Med | 1.0 |
| F19 | 3 | "Import" silently re-routes to a GitHub-connect terminal if not authed; import surface is repo/owner/org jargon | `DashboardHeader.tsx:50-58`; `Step1AccountSelection.tsx:18-99` | Route to ImportTypePicker (Local Folder needs no GitHub); plain subtitle on account step | M | Med | 1.0 |
| F24 | 4 | Generic/unknown projects silently get NO preview + NO dev server; "Edit dev command" lives only in Cmd+K | `useDevServer.ts:565-604`; `WorkspaceView.tsx:625-638,1100-1102` | Right-pane empty-state ("tell us how to start this project") with a Button that opens `devCommand` modal | M | Med | 1.0 |
| F26 | 4 | Agent-spawn failure / startup-timeout written as red ANSI ("npm install -g …") inside xterm; no actionable UI | `Terminal.tsx:639-650,850-857`; `agent.ts:51,66,81` | Set a React `spawnFailed` state → overlay with "Re-run setup" / "Get help" Buttons | M | Med | 1.0 |
| F7 | 1 | "Most users finish in under 3 minutes" is contradicted by a real fresh-machine install | `OnboardingScreen.tsx:507-509`; `setup.ts:191-206` | Soften to a range / pair with live progress | S | Low | 1.0 |
| F20 | 3 | Project name silently slugified ("My Portfolio" → "my-portfolio"); header shows original | `useProjectCreation.ts:360-364`; `CreateProject.tsx:163` | Live "Will be created as: <slug>" hint from a shared sanitize helper | S | Low | 1.0 |
| F28 | 4 | Dependency install (good CTA) runs in a raw terminal flooding pnpm warnings; no framing/success confirm | `Preview.tsx:715-743`; `WorkspaceView.tsx:1551-1554` | Friendly ModalFrame header + Spinner ("warnings in yellow are normal") + success toast on exit 0 | S | Low | 1.0 |
| F14 | 2 | Vercel connect = same raw terminal; `vercel whoami` status check has no timeout | `setup.ts:565-567,632-639`; `status.rs:408-437` | Browser-poll modal + reinforce optionality; wrap `whoami` in `run_with_timeout` | M | Low | 0.5 |

**The single "first win" moment:** the **live Preview iframe rendering the user's own running app** — `Preview.tsx:1036-1042` (`<iframe class="preview-iframe" src={conn.serverReady ? conn.currentUrl : 'about:blank'}>`), gated by `conn.serverReady`. For a web project the dev server auto-starts (`useDevServer.ts:678-696`) and the preview swaps `about:blank` for their site. Everything before this is setup; this is the payoff the tour must build toward.

---

## PART B — Demo tour spec

**Goal.** Pre-empt the highest-leverage first-run frictions (F22, F23, F25, F27, and the dashboard/template confusions F15/F16) with a short guided tour that points the persona at the right thing at the right moment — instead of leaving them to decode raw terminals and dev chrome.

**Trigger / skip / replay.**
- **Auto-trigger:** first time a project **workspace** mounts, gated on `localStorage['shipstudio.hasSeenWorkspaceTour']` (set when finished or skipped). The workspace is where the first-win lives and where the scary chrome (terminal, preview) concentrates.
- **Skip:** every step has a "Skip tour" affordance; skipping sets the flag.
- **Replay:** a persistent, visible **GraduationCap** button in the workspace toolbar (`toolbar-icon-btn`, reusing the icon `EducationOverlay` already imports) + a Cmd+K command `tour.replay` (via `useCommands`). Replaying ignores the flag.

**Anchoring.** Reuse the existing `data-education-id` convention and the `educationContent` copy map — the anchors already exist in the DOM (`claude-terminal` at `WorkspaceView.tsx:1178`, `screenshot-button`, `breakpoints`, preview pane). The tour is a thin **sequenced** controller layered on the same anchor system + `document.elementFromPoint`/`getBoundingClientRect` positioning that `EducationOverlay` already uses — not a new anchor scheme.

**Steps (7 max).**

| # | UI anchor (component) | What it says / unblocks | Maps to |
|---|----------------------|--------------------------|---------|
| 1 | Agent terminal — `data-education-id="claude-terminal"` (`Terminal.tsx` / `WorkspaceView.tsx:1178`) | "This is your AI builder. Click it and type plain English — 'build me a pricing page' — then press Enter. It writes the code for you." Demystifies the black box. | F22 |
| 2 | Same terminal (call-to-action) | "Go ahead — describe the site you want. Your AI starts building immediately." Nudges the user to take the action that triggers the first win. | F22 |
| 3 ★ | **Live preview pane** — `Preview.tsx` iframe / preview container | **"Your site appears here the moment it's ready. The first load can take a minute — that's normal."** This frames the warm-up wait so the user doesn't read it as broken. | F25 (the **first-win** step) |
| 4 | Device sizes — `data-education-id="breakpoints"` | "Check how your site looks on phone and tablet here." | F27 |
| 5 | Screenshot → agent — `data-education-id="screenshot-button"` (`WorkspaceView.tsx:1329-1363`) | "Snap your preview and it goes straight to your AI — perfect for 'make this part look like X'." Teaches the core design loop. | F27 |
| 6 | Dev-server status / "Fix with agent" (`DevServerStatus.tsx`) | "If the preview ever gets stuck, the green 'Fix with agent' button hands the problem to your AI to solve." | F25 |
| 7 | Replay button (GraduationCap toolbar button) | "Click here anytime to see this tour again, or turn on Learn Mode to hover and learn any button." | F23 |

**The "first win" moment** the tour centers on: **step 3** — the preview iframe swapping `about:blank` for the user's own running app.

**Reuse vs. new.**
- **Reuse:** `data-education-id` anchors + `educationContent` copy; `EducationOverlay`'s element-locating + tooltip-positioning approach; `ModalFrame` for an optional welcome card; `Button`/`Spinner` primitives; `useCommands` for the replay command; `useOpenModal` if any step opens a modal; design tokens for the highlight ring/bubble.
- **New (small):** a `WorkspaceTour` controller component + a `useWorkspaceTour` hook holding step index + the localStorage flag; one tour-state CSS block under `src/styles/modes/` (alongside `education-mode.css`); a GraduationCap toolbar button. No new anchor system, no new modal system.

---

## PART C — Build order (one commit each, pinned items first)

> Rules: pinned items are **not** subject to ranking — they ship first. Each item is sliced to ~one commit. Gates per item: `pnpm check:all && pnpm test:run && pnpm rust:test`. Commit only on green; keep the tree clean between items.

### PINNED — P1. Code-view file-tree drag-and-drop

Locations (verified): `src/components/code/FileTree.tsx` (pure presentational tree), `src/components/code/CodeTab.tsx` (container, rendered at `WorkspaceView.tsx:1440`), `src/hooks/useFileTree.ts`, `src/lib/code.ts`, backend `src-tauri/src/commands/code.rs` (currently read-only), security helpers in `src-tauri/src/utils.rs` (`validate_project_path`), write precedents in `src-tauri/src/commands/assets.rs` (`upload_asset`/`rename_asset` — symlink guards + canonical containment), OS drag-drop via the `tauri://drag-drop` event (`{paths, position}`, per `Terminal.tsx:255`), command registration at `src-tauri/src/lib.rs:592`, CSS in `src/styles/modes/code-mode.css`.

- [ ] **C1 — Backend fs commands.** Add to `code.rs`: `move_project_entry(project_path, from_rel, to_dir_rel)` — git-aware (use `git mv` when the source is tracked, detected via `git ls-files --error-unmatch`; else `fs::rename`), and `import_paths_to_project(project_path, abs_paths, to_dir_rel)` — copy OS files/dirs into a project folder. Both: validate via `validate_project_path`, reject `..`/symlink-final-component (mirror `assets.rs`), reject dropping a folder into its own descendant, reject collisions (return a typed `CommandError`, never silently overwrite). Register in `lib.rs`. Add `#[cfg(test)]` coverage (descendant-guard, traversal, collision). Add TS wrappers in `lib/code.ts`.
- [ ] **C2 — In-tree MOVE drag-drop.** Make `FileTree.tsx` items draggable; drop onto a folder relocates (drop onto a file → its parent folder); drop on root → project root. Drop-target highlight + invalid-drop cursor; block dropping onto self/descendant in the UI too. On collision, a `ModalFrame` prompt: Rename / Replace / Skip. After a tracked-file move, surface a non-blocking flag ("this may break code imports — your agent can fix references"). Wire through `CodeTab.tsx`/`useFileTree.ts` (refresh tree after move). Multi-select drag where feasible.
- [ ] **C3 — OS IMPORT drag-drop.** Listen for `tauri://drag-drop` while the Code tab is active; hit-test `position` → drop-target folder via `document.elementFromPoint` (as `EducationOverlay` does); call `import_paths_to_project`; same collision modal (Rename/Replace/Skip), drop-target highlight, and "dropped on root" handling. Distinguish OS-drop (Tauri paths) from in-tree move (no double-handling).

### RANKED FIXES — do-first first

- [ ] **C4 — F1 ★** Homebrew terminal reassurance banner (password prompt is expected/safe) in `.onboarding-terminal-header`, gated on `itemId==='homebrew'`. Copy-only + small CSS.
- [ ] **C5 — F6 ★ + F2 + F4 + F13** First-run wizard "plain-language pass": rewrite step subtitles to explain WHY (one-time free tool setup), reword the blocked-row copy, add a disabled-Next reason line, rename scary item labels. Mostly `setup.ts` + `SetupItem.tsx` + `OnboardingScreen.tsx` copy.
- [ ] **C6 — F9 ★ (+F8/F10 follow-on)** Wire the existing friendly browser-auth path: call `startGitHubAuth`/`startClaudeAuth` from `handleItemAction` for `*_auth`, render the returned message in a `ModalFrame` + `Spinner`, poll status until authed; keep the raw terminal as a labeled fallback. *(If this proves too large for one clean green commit, descope to surfacing the friendly message + reassurance and defer the full rewire.)*
- [ ] **C7 — F15** Zero-projects dashboard: pass a "+ Create your first project" `Button` into the empty `EmptyState` (`ProjectGridView.tsx:75`); gate the dev chrome (AgentsPanel/IntegrationBar/GitHubCalendar) behind `projects.length>0`.
- [ ] **C8 — F16** Template grid: "Recommended" pill on the default tile, group Websites/Mobile/Other, rewrite descriptions in designer language (`useProjectCreation.ts` + `CreateProject.tsx`).
- [ ] **C9 — F22** Agent-terminal first-run hint overlay (reuse the dim scrim div) gated on a localStorage flag flipped on first `onData`.
- [ ] **C10 — F21** Surface the silent community-template download failure via toast/`setError`.
- [ ] **C11 — F25** Dev-server warm-up: calmer copy until ~attempt 15; make "Fix with agent" primary + always present.
- [ ] **C12 — F27** Inline "Agent is working…" indicator (Spinner) in the terminal pane header from existing `AgentStatus`.

### THE TOUR (PART B)

- [ ] **C13 — F23** `WorkspaceTour` controller + `useWorkspaceTour` hook (localStorage flag), 7 steps on existing `data-education-id` anchors, GraduationCap toolbar replay button, `tour.replay` Cmd+K command, tour CSS under `src/styles/modes/`.

### LATER (not in this pass unless budget remains)

F3 (stream brew install + timeout), F17 (non-CLI project-creation error path + backend fix command), F18 (live install feedback), F19 (import routing), F24 (generic-project preview CTA), F26 (agent-spawn-failure overlay), F5/F11 (install/auth failure help), F28 (friendly install modal), F7/F20/F14 (copy + timeout polish).

---

*Generated 2026-06-13 from a 4-subagent read-only audit. Every PART A row cites a file/function/UI step; PART C items are sliced to one commit each and gated on `pnpm check:all && pnpm test:run && pnpm rust:test`.*
