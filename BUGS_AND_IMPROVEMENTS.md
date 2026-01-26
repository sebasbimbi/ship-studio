# Ship Studio - Bugs and Improvements Report

This document contains a comprehensive analysis of the Ship Studio codebase, identifying bugs, potential issues, and improvement opportunities.

> **Last Updated:** January 2026
> **Branch:** josh/bugs-improvements

---

## Fixed Issues Summary

The following issues have been addressed in this branch:

| # | Issue | Status |
|---|-------|--------|
| 1 | Screenshot capture `isCapturing` not functional | ✅ Fixed |
| 2 | Auth polling not properly tracked | ✅ Fixed |
| 3 | Process cleanup timing arbitrary | ✅ Fixed |
| 4 | CSP disabled | ✅ Fixed |
| 5 | Silent error handling | ✅ Fixed |
| 6 | Potential unwrap panics | ✅ Fixed |
| 7 | Stashed changes not tracked | ✅ Fixed |
| 8 | Force push to staging | ✅ Fixed |
| 9 | No timeout on Vercel API polling | ✅ Fixed |
| 10 | Project metadata schema versioning | ✅ Fixed |
| 11 | Git status parsing | ✅ Already defensive |
| 12 | Env variable value length limit | ✅ Fixed |
| 13 | Two sources of truth for Vercel connection | ✅ Fixed |
| 14 | Dev server crash detection | ✅ Fixed |
| 15 | Centralize executable finding in backend | ✅ Fixed (Tyler) |
| 16 | NVM path iteration slow | ✅ Fixed |
| 17 | Spawned auth processes forgotten | ✅ Fixed |
| 18 | Commit messages customizable | ✅ Fixed |

---

## Critical Issues

### 1. Screenshot Capture Not Fully Implemented ✅ FIXED

**Location:** [Preview.tsx:121](src/components/Preview.tsx#L121)

**Original Issue:** The `isCapturing` state was hardcoded to `false` with no setter. The TODO comment was outdated as capture was already implemented.

**Fix Applied:**
- Added setter for `isCapturing` state
- Updated `captureForClaude` to set `isCapturing` to true/false during capture
- Removed outdated TODO comment
- Added guard to prevent concurrent captures

---

### 2. Auth Polling Not Properly Awaited ✅ FIXED

**Location:** [GitHubButton.tsx](src/components/GitHubButton.tsx)

**Original Issue:** `pollAuth()` was not awaited and could run multiple times if user clicked repeatedly.

**Fix Applied:**
- Added `authPollRunningRef` to track if polling is in progress
- Prevent starting new poll if one is already running
- Reset running state on unmount and auth success
- Use `void pollAuth()` to explicitly indicate fire-and-forget

---

### 3. Process Cleanup Timing Is Arbitrary ✅ FIXED

**Location:** [pty.rs](src-tauri/src/commands/pty.rs)

**Original Issue:** 100ms fixed sleep before force-killing was arbitrary.

**Fix Applied:**
- Added `is_process_running()` helper function using `kill -0`
- Increased grace period to 2 seconds
- Poll every 100ms to check if process exited
- Only force-kill if process is still running after grace period

---

### 4. Content Security Policy Disabled ✅ FIXED

**Location:** [tauri.conf.json](src-tauri/tauri.conf.json)

**Original Issue:** CSP was completely disabled (`null`).

**Fix Applied:** Added comprehensive CSP:
```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: asset: https:;
font-src 'self' data:;
connect-src 'self' http://localhost:* ws://localhost:* wss://localhost:* https://*.github.com https://*.vercel.com https://api.anthropic.com;
frame-src http://localhost:*;
```

---

## High Priority Issues

### 5. Silent Error Handling Masks Problems ✅ FIXED

**Location:** Multiple files

**Fix Applied:**
- Added `eprintln!` logging for unexpected git pull errors in [publishing.rs](src-tauri/src/commands/publishing.rs)
- Added logging for git fetch failures in [git.rs](src-tauri/src/commands/git.rs)
- Expected errors (no tracking branch, no remote ref) are filtered out

---

### 6. Potential Unwrap Panics ✅ FIXED

**Fix Applied:**
- [vercel.rs](src-tauri/src/commands/vercel.rs): Changed `serde_json::to_string_pretty().unwrap()` to use `?` operator
- [claude.rs](src-tauri/src/commands/claude.rs): Changed `unwrap()` to `match` pattern
- [ide.rs](src-tauri/src/commands/ide.rs): Changed mutex lock `unwrap()` to `map_err()?`

---

### 7. Stashed Changes Not Applied When Switching Back ✅ FIXED

**Location:** [git.rs](src-tauri/src/commands/git.rs)

**Original Issue:** When switching branches with uncommitted changes, the code stashes them but never automatically applies them when switching back. Users could lose track of stashed changes.

**Fix Applied:**
- Added `StashInfo` struct to track source branch and timestamp
- Added `stash_info` field to `ProjectMetadata` in `.shipstudio/project.json`
- Updated `switch_branch` to save stash info when auto-stashing
- Auto-applies stash when switching back to the original branch
- Returns `pending_stash_from` in `SwitchResult` if a stash exists for another branch
- Added new commands: `get_stash_info`, `apply_stash`, `drop_stash`
- Added `get_current_branch_sync` helper for synchronous branch detection

---

### 8. Force Push to Staging Without Warning ✅ FIXED

**Location:** [publishing.rs](src-tauri/src/commands/publishing.rs)

**Original Issue:** Publishing to staging used force push (`-f`).

**Fix Applied:**
- Removed `-f` flag from staging push
- Added better error message for push rejection (non-fast-forward)
- Now returns clear error asking user to pull changes first

---

## Medium Priority Issues

### 9. No Timeout on Vercel API Polling ✅ FIXED

**Location:** [vercel.rs](src-tauri/src/commands/vercel.rs)

**Original Issue:** Polling for Vercel deployment status had no maximum timeout. If Vercel API is slow or stuck, the app could poll indefinitely.

**Fix Applied:**
- Added `VERCEL_CLI_TIMEOUT_SECS` constant (30 seconds) for CLI operations
- Added `VERCEL_DEPLOY_TIMEOUT_SECS` constant (300 seconds / 5 minutes) for deployments
- Created `run_command_with_timeout` async helper using tokio timeout
- Updated `get_deployment_status` and `get_vercel_deployments` to use 30-second timeout
- Commands now return clear "Command timed out" error instead of hanging

---

### 10. Project Metadata Schema Has No Versioning ✅ FIXED

**Location:** [types.rs](src-tauri/src/types.rs) and [projects.rs](src-tauri/src/commands/projects.rs)

**Original Issue:** If the schema for `ProjectMetadata` changes in a future version, there's no migration path for existing projects.

**Fix Applied:**
- Added `PROJECT_METADATA_SCHEMA_VERSION` constant (currently 1) in types.rs
- Added `schema_version` field to `ProjectMetadata` struct with default value for legacy files
- Added `migrate()` method to `ProjectMetadata` for handling version upgrades
- Updated `read_project_metadata` to automatically apply migrations when reading
- Updated `write_project_metadata` to ensure schema_version is always current
- Future schema changes can now be handled gracefully with migration logic

---

### 11. Git Status Parsing Assumes Specific Format ✅ ALREADY DEFENSIVE

**Location:** [git.rs](src-tauri/src/commands/git.rs)

**Analysis:** Code already has defensive checks:
- `if line.len() < 3 { continue; }` before parsing
- `if parts.len() == 2` check before accessing array elements
- Uses `unwrap_or(0)` for parsing numbers

No changes needed.

---

### 12. Environment Variable Values Have No Length Limit ✅ FIXED

**Location:** [env.rs](src-tauri/src/commands/env.rs)

**Fix Applied:**
- Added `MAX_ENV_KEY_LENGTH` constant (256 bytes)
- Added `MAX_ENV_VALUE_LENGTH` constant (65536 bytes / 64KB)
- Added validation for both key and value lengths with clear error messages

---

### 13. Two Sources of Truth for Vercel Connection ✅ FIXED

**Location:** [vercel.rs](src-tauri/src/commands/vercel.rs)

**Original Issue:** Vercel connection info was stored in two places that could diverge if user runs Vercel CLI directly.

**Fix Applied:**
- Updated `get_vercel_deployment_info` to check `.vercel/project.json` first as source of truth
- Only falls back to reading project metadata if `.vercel/project.json` doesn't exist
- `.shipstudio/project.json` is now only used for deployment timestamps, not connection status
- This ensures the UI always reflects the actual Vercel project linkage

---

### 14. Preview Shows Black Screen If Dev Server Crashes ✅ FIXED

**Location:** [Preview.tsx](src/components/Preview.tsx)

**Fix Applied:**
- Added periodic health check every 10 seconds while server is ready
- If health check fails, sets `serverReady` to false and `hasError` to true
- Shows error state instead of black screen
- User can click "Retry" to attempt reconnection

---

## Low Priority Issues

### 15. Inconsistent Executable Finding Between Frontend and Backend ✅ FIXED

**Location:** [pty.rs](src-tauri/src/commands/pty.rs)

**Original Issue:** The backend builds PATH by iterating NVM versions, but frontend assumes tools are available via Tauri invoke. If the PATH building logic differs, tools might be found in one place but not another.

**Fix Applied (by Tyler):**
- Added `get_shell_path` Tauri command that returns the extended PATH from backend
- Frontend can now use this to ensure consistent PATH resolution
- Centralized shell path building in the backend

---

### 16. NVM Path Iteration Could Be Slow ✅ FIXED

**Location:** [utils.rs](src-tauri/src/utils.rs)

**Fix Applied:**
- First tries to read NVM's default alias file
- If default found, uses only that version's path
- Falls back to finding the latest installed version (sorted descending)
- Only adds a single NVM path instead of all versions

---

### 17. Spawned Auth Processes Are Forgotten ✅ FIXED

**Location:** [setup.rs](src-tauri/src/commands/setup.rs)

**Original Issue:** The spawned process handles were deliberately forgotten with `std::mem::forget(child)`, which means:
- No way to know if auth process succeeded or failed
- Process runs orphaned if the app closes

**Fix Applied:**
- Added global `AUTH_PIDS` registry to track auth process PIDs (GitHub, Claude, Vercel)
- Updated `start_github_auth`, `start_claude_auth`, and `start_vercel_auth` to store PIDs
- Each auth process now spawns a background thread to wait for completion and remove PID from registry
- Added `cleanup_auth_processes_sync` helper function for synchronous cleanup
- Added `cleanup_auth_processes` Tauri command for frontend access
- Window destroy event now calls cleanup to terminate any lingering auth processes

---

### 18. Hardcoded Commit Messages ✅ FIXED

**Location:** [publishing.rs](src-tauri/src/commands/publishing.rs)

**Fix Applied:**
- `publish_to_staging` now accepts optional `commit_message` parameter
- `publish_to_production` now accepts optional `commit_message` parameter
- Default message is "Update from Ship Studio" if none provided
- Frontend can now pass custom commit messages

---

## Improvement Opportunities

### 1. Add Automated Tests

**Current State:** No automated tests for backend or frontend

**Recommendation:**
- Add unit tests for git parsing logic
- Add integration tests for Tauri commands
- Add E2E tests for critical workflows (project creation, publishing)

---

### 2. Add Telemetry/Logging for Silent Failures

Many operations silently fail. Adding optional telemetry or structured logging would help:
- Debug user issues
- Understand which operations fail most often
- Improve reliability over time

---

### 3. Implement Exponential Backoff for Polling

All polling currently uses fixed intervals. Exponential backoff would:
- Reduce API rate limit hits
- Improve perceived performance
- Save resources

---

### 4. Add Health Check Heartbeat for Dev Server

The dev server is only checked at startup. A periodic heartbeat would:
- Detect crashes faster
- Allow automatic restart
- Improve user experience

---

### 5. Cache Git Command Results

Git status is checked every 3-5 seconds via polling. Caching results with invalidation based on file system events would:
- Reduce CPU usage
- Make the app feel more responsive
- Reduce git process spawning overhead

---

### 6. Consider Using Git2 Library

Currently all git operations spawn `git` CLI commands. Using [git2-rs](https://github.com/rust-lang/git2-rs) would:
- Eliminate process spawn overhead
- Provide better error handling
- Enable more sophisticated git operations

---

## Known Limitations (From README)

These are documented limitations that users should be aware of:

1. **Page Selector Navigation** - Cross-origin security prevents tracking page changes clicked in iframe
2. **Vercel Detection** - External deployments show wrong status until redeployed through app
3. **Terminal Refocus** - User must click terminal after modal closes

---

## Summary

| Priority | Fixed | Pending |
|----------|-------|---------|
| Critical | 4 | 0 |
| High | 4 | 0 |
| Medium | 6 | 0 |
| Low | 4 | 0 |
| **Total** | **18** | **0** |

### All Issues Resolved

All identified bugs and issues have been addressed in this branch.

**Improvement Opportunities (Not Started):**
1. Add automated tests
2. Add telemetry/logging
3. Implement exponential backoff for polling
4. Cache git command results
5. Consider using git2-rs library

The codebase is generally well-structured with good documentation and security practices. The fixes in this branch address the most critical issues related to error handling, security (CSP), and user experience (crash detection, proper state management).
