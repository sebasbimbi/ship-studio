# Ship Studio — Project Settings & Toolbar Cleanup

## What This Is

Ship Studio is a desktop app for web developers that provides project management, an integrated Claude Code terminal, git/GitHub workflows, and Vercel deployment. This milestone focuses on cleaning up the workspace toolbar and adding per-project settings, starting with dev server port configuration.

## Core Value

Developers can configure their dev server port per-project so Ship Studio works correctly regardless of which port their framework uses.

## Requirements

### Validated

- ✓ Project management (create, import, open) — existing
- ✓ Integrated terminal with Claude Code — existing
- ✓ Branch management and git operations — existing
- ✓ Pull request creation with AI-generated descriptions — existing
- ✓ Merge conflict resolution UI — existing
- ✓ Asset management for /public folder — existing
- ✓ IDE integration (VS Code, Cursor) — existing
- ✓ Vercel deployment to staging/production — existing
- ✓ Auto-updates — existing
- ✓ Dev server auto-start and preview — existing
- ✓ Restart Server button in workspace toolbar — existing

### Active

- [ ] Restart Server button shows only refresh icon (no text label)
- [ ] Settings cog icon button added next to restart button in toolbar
- [ ] Clicking settings cog opens a Project Settings modal dialog
- [ ] Project Settings modal has a Dev Server Port field
- [ ] Dev server port defaults to 3000
- [ ] Port setting is stored in `.shipstudio/project.json` per-project
- [ ] Changing port only affects Ship Studio's dev server, not project source code

### Out of Scope

- Changing project framework config files — port is Ship Studio-only
- Global/app-level settings — this is per-project only
- Other settings beyond port — future milestone

## Context

- The restart server button currently shows both an icon and "Restart Server" text label
- Ship Studio auto-detects project type and runs the appropriate dev server command
- Project metadata is already stored in `.shipstudio/project.json` (publish records, timestamps)
- The dev server runs via PTY and connects to a preview proxy
- Port 3000 is the current hardcoded default but many frameworks use other ports (5173 for Vite, 4321 for Astro, 8080 for various tools)

## Constraints

- **UI consistency**: Toolbar buttons should follow existing `.toolbar-icon-btn` CSS class patterns
- **Non-destructive**: Port setting must not modify any project source files
- **Backward compatible**: Existing projects without a port setting should default to 3000

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Modal dialog for settings | User preference — centered overlay with form fields | — Pending |
| Store port in .shipstudio/project.json | Per-project, already used for metadata | — Pending |
| Default port 3000 | Most common default across frameworks | — Pending |

---
*Last updated: 2026-02-28 after initialization*
