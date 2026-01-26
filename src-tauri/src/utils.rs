//! # Shared Utilities
//!
//! This module contains shared utility functions used across the Ship Studio backend.

use std::process::Command;

/// Builds an extended PATH that includes common tool installation locations.
/// macOS apps launched from Finder don't inherit the user's shell PATH,
/// so we need to explicitly add Homebrew, npm global, and NVM paths.
pub fn get_extended_path() -> String {
    let current_path = std::env::var("PATH").unwrap_or_default();

    let mut paths: Vec<String> = vec![
        "/opt/homebrew/bin".to_string(),      // Homebrew (Apple Silicon)
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),         // Homebrew (Intel) / manual installs
        "/usr/local/sbin".to_string(),
    ];

    // Add user-specific paths
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy();
        paths.push(format!("{}/.npm-global/bin", home_str));
        paths.push(format!("{}/.local/bin", home_str)); // Official Claude installer location
        paths.push(format!("{}/n/bin", home_str));

        // Add NVM current/default version if it exists
        // First try the default alias, then fall back to finding the latest version
        let nvm_dir = home.join(".nvm");
        let nvm_default = nvm_dir.join("alias/default");
        let nvm_versions = nvm_dir.join("versions/node");

        if nvm_versions.exists() {
            // Check if there's a default alias
            let default_version = std::fs::read_to_string(&nvm_default)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            if let Some(version) = default_version {
                // Default alias might be "lts/iron" or a version like "v20.10.0"
                // Try to resolve it to an actual path
                let version_path = if version.starts_with("lts/") || version.starts_with("node") {
                    // For lts aliases, we'd need to read more files - just use latest version
                    None
                } else {
                    // Direct version reference
                    let path = nvm_versions.join(&version);
                    if path.exists() { Some(path) } else { None }
                };

                if let Some(path) = version_path {
                    paths.push(format!("{}/bin", path.to_string_lossy()));
                }
            }

            // If no default found or couldn't resolve, find the latest installed version
            if paths.iter().all(|p| !p.contains(".nvm/versions/node")) {
                if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                    // Get all version directories and sort to find the latest
                    let mut versions: Vec<_> = entries
                        .filter_map(|e| e.ok())
                        .filter(|e| e.path().is_dir())
                        .collect();

                    // Sort by version (descending) - versions are like "v20.10.0"
                    versions.sort_by(|a, b| {
                        let a_name = a.file_name().to_string_lossy().to_string();
                        let b_name = b.file_name().to_string_lossy().to_string();
                        b_name.cmp(&a_name) // Reverse order for descending
                    });

                    // Use the latest version only
                    if let Some(latest) = versions.first() {
                        paths.push(format!("{}/bin", latest.path().to_string_lossy()));
                    }
                }
            }
        }

        // Add Claude desktop app's bundled CLI paths
        let claude_app_base = home.join("Library/Application Support/Claude/claude-code");
        if claude_app_base.exists() {
            if let Ok(entries) = std::fs::read_dir(&claude_app_base) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        paths.push(entry.path().to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    // Append existing PATH
    if !current_path.is_empty() {
        paths.push(current_path);
    }

    paths.join(":")
}

/// Finds an executable by checking common installation paths.
/// This is needed because bundled macOS apps don't inherit the user's shell PATH.
pub fn find_executable(cmd: &str) -> Option<std::path::PathBuf> {
    // First try which (works in dev and if PATH is set)
    if let Ok(path) = which::which(cmd) {
        return Some(path);
    }

    // Check common installation paths for macOS
    let common_paths = vec![
        std::path::PathBuf::from("/opt/homebrew/bin").join(cmd),  // Homebrew (Apple Silicon)
        std::path::PathBuf::from("/usr/local/bin").join(cmd),     // Homebrew (Intel) / manual
        std::path::PathBuf::from("/usr/bin").join(cmd),           // System
    ];

    for path in common_paths {
        if path.exists() {
            return Some(path);
        }
    }

    // For npm-installed tools (like claude), check additional locations
    if let Some(home) = dirs::home_dir() {
        let npm_paths = vec![
            home.join(".npm-global/bin").join(cmd),
            home.join("n/bin").join(cmd),  // n version manager
        ];

        for path in npm_paths {
            if path.exists() {
                return Some(path);
            }
        }

        // Check NVM installations (glob for any node version)
        let nvm_base = home.join(".nvm/versions/node");
        if nvm_base.exists() {
            if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                for entry in entries.flatten() {
                    let bin_path = entry.path().join("bin").join(cmd);
                    if bin_path.exists() {
                        return Some(bin_path);
                    }
                }
            }
        }
    }

    None
}

/// Validates that a project path is inside the ~/ShipStudio directory.
/// Prevents path traversal attacks where frontend could pass arbitrary paths.
pub fn validate_project_path(project_path: &str) -> Result<std::path::PathBuf, String> {
    let path = std::path::Path::new(project_path);
    let canonical = path.canonicalize().map_err(|e| format!("Invalid path: {}", e))?;

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let shipstudio_dir = home.join("ShipStudio");

    if !canonical.starts_with(&shipstudio_dir) {
        return Err(format!(
            "Security error: path '{}' is outside ShipStudio directory",
            project_path
        ));
    }

    Ok(canonical)
}

/// Check if Homebrew is installed
pub fn check_homebrew() -> (bool, Option<String>) {
    let paths = [
        std::path::PathBuf::from("/opt/homebrew/bin/brew"),
        std::path::PathBuf::from("/usr/local/bin/brew"),
    ];

    for path in paths {
        if path.exists() {
            // Get version
            let version = Command::new(&path)
                .args(["--version"])
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        let out = String::from_utf8_lossy(&o.stdout);
                        out.lines().next().map(|s| s.trim().to_string())
                    } else {
                        None
                    }
                });
            return (true, version);
        }
    }
    (false, None)
}

/// Get Homebrew command path
pub fn get_brew_command() -> Option<std::path::PathBuf> {
    let paths = [
        std::path::PathBuf::from("/opt/homebrew/bin/brew"),
        std::path::PathBuf::from("/usr/local/bin/brew"),
    ];
    paths.into_iter().find(|p| p.exists())
}

/// Helper to format relative time
pub fn format_relative_time(timestamp_ms: u64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let diff_ms = now.saturating_sub(timestamp_ms);
    let seconds = diff_ms / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;
    let days = hours / 24;

    if days > 0 {
        format!("{}d ago", days)
    } else if hours > 0 {
        format!("{}h ago", hours)
    } else if minutes > 0 {
        format!("{}m ago", minutes)
    } else {
        "just now".to_string()
    }
}
