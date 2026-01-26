//! # Publishing Commands
//!
//! Commands for publishing to GitHub, staging, and production.

use std::process::Command;
use crate::types::PublishResult;
use crate::utils::validate_project_path;
use crate::commands::git::git_stage_and_commit;

#[tauri::command]
pub async fn publish_to_github(project_path: String, commit_message: Option<String>) -> Result<(), String> {
    let validated_path = validate_project_path(&project_path)?;
    let message = commit_message.unwrap_or_else(|| "Update from Ship Studio".to_string());

    // Get current branch name
    let branch_output = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&validated_path)
        .output()
        .map_err(|e| e.to_string())?;

    let branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();
    let branch = if branch.is_empty() { "main".to_string() } else { branch };

    // Pull latest changes first (rebase to keep history clean)
    let pull_output = Command::new("git")
        .args(["pull", "--rebase", "origin", &branch])
        .current_dir(&validated_path)
        .output();

    // Handle pull errors - log unexpected ones but don't fail
    match pull_output {
        Ok(output) if !output.status.success() => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // These errors are expected for new repos/branches
            let is_expected_error = stderr.contains("no tracking")
                || stderr.contains("Couldn't find remote ref")
                || stderr.contains("There is no tracking information")
                || stderr.contains("fatal: couldn't find remote ref");

            if !is_expected_error {
                // Log unexpected pull errors for debugging
                eprintln!("[publish_to_github] Unexpected pull error (continuing anyway): {}", stderr);
            }
        }
        Err(e) => {
            eprintln!("[publish_to_github] Failed to execute git pull: {}", e);
        }
        _ => {}
    }

    // Stage all changes
    let output = Command::new("git")
        .args(["add", "-A"])
        .current_dir(&validated_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    // Check if there are changes to commit
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&validated_path)
        .output()
        .map_err(|e| e.to_string())?;

    let has_changes = !String::from_utf8_lossy(&status.stdout).trim().is_empty();

    if has_changes {
        // Commit changes
        let output = Command::new("git")
            .args(["commit", "-m", &message])
            .current_dir(&validated_path)
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }

    // Push to origin
    let output = Command::new("git")
        .args(["push", "-u", "origin", &branch])
        .current_dir(&validated_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("Everything up-to-date") {
            return Err(stderr.to_string());
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn publish_to_staging(project_path: String, commit_message: Option<String>) -> Result<PublishResult, String> {
    let validated_path = validate_project_path(&project_path)?;
    let message = commit_message.unwrap_or_else(|| "Update from Ship Studio".to_string());

    // Stage and commit any changes
    let _ = git_stage_and_commit(&validated_path, &message);

    // Push to staging branch - Vercel auto-deploys via GitHub integration
    // Note: Using regular push instead of force push to avoid overwriting others' work
    let push_output = Command::new("git")
        .args(["push", "-u", "origin", "HEAD:staging"])
        .current_dir(&validated_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        if stderr.contains("rejected") || stderr.contains("non-fast-forward") {
            return Err(format!("PUSH_REJECTED: Staging branch has diverged. Pull changes first or resolve conflicts.\n{}", stderr));
        }
        if !stderr.contains("Everything up-to-date") {
            return Err(stderr.to_string());
        }
    }

    Ok(PublishResult {
        url: String::new(),
        state: "QUEUED".to_string(),
    })
}

#[tauri::command]
pub async fn publish_to_production(project_path: String, commit_message: Option<String>) -> Result<PublishResult, String> {
    let validated_path = validate_project_path(&project_path)?;
    let message = commit_message.unwrap_or_else(|| "Update from Ship Studio".to_string());

    // Stage and commit any changes
    let _ = git_stage_and_commit(&validated_path, &message);

    // Push to main branch - Vercel auto-deploys to production via GitHub integration
    let push_output = Command::new("git")
        .args(["push", "-u", "origin", "HEAD:main"])
        .current_dir(&validated_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        if !stderr.contains("Everything up-to-date") {
            return Err(stderr.to_string());
        }
    }

    Ok(PublishResult {
        url: String::new(),
        state: "QUEUED".to_string(),
    })
}

/// Publish (push) the current branch to origin
#[tauri::command]
pub async fn publish_branch(project_path: String, commit_message: Option<String>) -> Result<PublishResult, String> {
    let validated_path = validate_project_path(&project_path)?;
    let message = commit_message.unwrap_or_else(|| "Updates from Ship Studio".to_string());

    // Get current branch name
    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&validated_path)
        .output()
        .map_err(|e| e.to_string())?;

    let branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();

    // Stage all changes
    let _ = Command::new("git")
        .args(["add", "-A"])
        .current_dir(&validated_path)
        .output();

    // Check if there are changes to commit
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&validated_path)
        .output()
        .map_err(|e| e.to_string())?;

    let has_changes = !String::from_utf8_lossy(&status.stdout).trim().is_empty();

    if has_changes {
        // Commit changes
        let commit_output = Command::new("git")
            .args(["commit", "-m", &message])
            .current_dir(&validated_path)
            .output()
            .map_err(|e| e.to_string())?;

        if !commit_output.status.success() {
            let stderr = String::from_utf8_lossy(&commit_output.stderr);
            return Err(format!("Failed to commit: {}", stderr));
        }
    }

    // Push to origin
    let push_output = Command::new("git")
        .args(["push", "-u", "origin", &branch])
        .current_dir(&validated_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        // Check for common errors
        if stderr.contains("rejected") || stderr.contains("non-fast-forward") {
            return Err(format!("PUSH_REJECTED:{}", stderr));
        }
        if stderr.contains("Permission denied") || stderr.contains("could not read Username") {
            return Err(format!("AUTH_ERROR:{}", stderr));
        }
        if !stderr.contains("Everything up-to-date") {
            return Err(stderr.to_string());
        }
    }

    Ok(PublishResult {
        url: String::new(),
        state: "QUEUED".to_string(),
    })
}
