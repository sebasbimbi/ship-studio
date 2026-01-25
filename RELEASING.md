# Releasing Ship Studio

## Quick Release (recommended)

### 1. Update RELEASE_NOTES.md (REQUIRED)

**IMPORTANT: This step is mandatory. Users see these notes in the update dialog.**

Edit `RELEASE_NOTES.md` and update the "What's New" section with user-friendly descriptions of changes:

```markdown
## What's New in vX.Y.Z

- Added feature X for better Y
- Fixed bug where Z would happen
- Improved performance of W
```

### 2. Update version in all three files:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`

### 3. Commit all changes:
```bash
git add RELEASE_NOTES.md package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "Release vX.Y.Z - Brief description"
```

### 4. Create and push a tag:
```bash
git tag -a vX.Y.Z -m "vX.Y.Z - Brief description"
git push origin main && git push origin vX.Y.Z
```

### 5. Wait for GitHub Actions to complete (~8 minutes)

### 6. Publish the draft release in the main repo:
- https://github.com/ship-studio/ship-studio/releases
- (The public releases repo auto-publishes)

---

## What Happens Automatically

When you push a tag starting with `v`, GitHub Actions will:

1. **Build** the app for both ARM64 (Apple Silicon) and Intel Macs
2. **Sign** the app with the Apple Developer certificate
3. **Create** signed update bundles (`.tar.gz` + `.sig`)
4. **Read** release notes from `RELEASE_NOTES.md`
5. **Generate** `latest.json` manifest with notes and download URLs
6. **Upload** artifacts to both repos
7. **Auto-publish** the public releases repo release

## Why Two Repos?

The main `ship-studio/ship-studio` repo is **private** to protect source code. However, the auto-updater needs public URLs to download updates. The `ship-studio/releases` repo is **public** and only contains:

- `latest.json` - Version manifest for auto-updater (includes release notes)
- `ShipStudio_darwin-aarch64.app.tar.gz` - ARM64 update bundle
- `ShipStudio_darwin-x86_64.app.tar.gz` - Intel update bundle

No source code is exposed.

## Required Secrets

These secrets must be configured in the main repo's GitHub settings:

| Secret | Purpose |
|--------|---------|
| `APPLE_CERTIFICATE` | Base64-encoded .p12 certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the certificate |
| `TAURI_SIGNING_PRIVATE_KEY` | Private key for update signing |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the signing key |
| `RELEASES_PAT` | Personal Access Token with `public_repo` scope for cross-repo access |

## Verification Checklist

After the workflow completes:

- [ ] Draft release exists in main repo
- [ ] Public release is auto-published in releases repo
- [ ] Verify public URL works:
  ```bash
  curl -sL https://github.com/ship-studio/releases/releases/latest/download/latest.json | jq
  ```
- [ ] Verify release notes are included in the JSON
- [ ] Publish the main repo draft release
- [ ] Test auto-updater shows update available in-app

## Troubleshooting

### Workflow fails at "Create release in public releases repo"

The `RELEASES_PAT` secret may be missing or expired. Create a new Personal Access Token:
1. Go to https://github.com/settings/tokens
2. Generate new token (classic) with `public_repo` scope
3. Add it as `RELEASES_PAT` in repo secrets

### Auto-updater doesn't find updates

1. Ensure the release in `ship-studio/releases` is **published** (not draft)
2. Check `latest.json` URLs point to the public repo
3. Verify the app version is lower than the release version

### Release notes not showing

1. Ensure `RELEASE_NOTES.md` was updated before tagging
2. Check the workflow logs for the "Read release notes" step
