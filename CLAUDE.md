# Ship Studio Development Guidelines

## Core Principles

### Never Assume Data
- **Only display data that is reliably known** - never construct, guess, or infer values
- If data isn't available, either:
  1. Don't show that field at all
  2. Show a clear "unknown" or neutral state
  3. Redesign the UI to not need that data
- Example: Don't construct URLs like `https://{project-name}.vercel.app` - only show URLs that were explicitly returned from an API or saved from a real operation
- This prevents confusing users with incorrect information

### Data Storage
- Project metadata is stored in `.shipstudio/project.json` within each project
- This file stores: last_opened timestamp, publish records (staging/production with URL, state, publishedAt)
- Vercel project linking info is in `.vercel/project.json` (managed by Vercel CLI)
- Only trust data that was explicitly saved - don't infer state from file existence alone

## Architecture

### Backend (Rust/Tauri)
- All Tauri commands are in `src-tauri/src/lib.rs`
- Commands validate paths to ensure they're within `~/ShipStudio` directory
- Git operations use the `git` CLI directly
- Vercel operations use the `vercel` CLI

### Frontend (React/TypeScript)
- Components are in `src/components/`
- Lib functions (Tauri invoke wrappers) are in `src/lib/`
- Main app state is managed in `src/App.tsx`

## Common Patterns

### Publishing Flow
1. User clicks Publish in PublishDropdown
2. Backend pushes to GitHub (staging or main branch)
3. Vercel auto-deploys via GitHub integration
4. Result (URL, state, timestamp) is saved to `.shipstudio/project.json`

### Integration Status
- GitHub: Check via `gh auth status`
- Vercel: Check via `vercel whoami`
- Claude: Check via `claude --version`

## Releasing New Versions

**CRITICAL: When releasing a new version, you MUST update `RELEASE_NOTES.md` BEFORE creating the tag.**

The release notes in this file are shown to users in the update dialog. They need to know what's new.

### Release Checklist
1. **Update `RELEASE_NOTES.md`** - Write user-friendly notes about what changed
2. Update version in: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
3. Commit all changes
4. Create and push tag: `git tag -a vX.Y.Z -m "message" && git push origin main && git push origin vX.Y.Z`
5. Wait for GitHub Actions, then publish the draft release

See `RELEASING.md` for full details.
