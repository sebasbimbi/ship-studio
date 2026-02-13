//! # Static Server Commands
//!
//! Tauri commands for managing the built-in static file server
//! used by plain HTML/CSS/JS projects.

use crate::utils::validate_project_path;

/// Start a static file server for a project, returning the port it's listening on.
#[tauri::command]
pub async fn start_static_server(
    window_label: String,
    project_path: String,
) -> Result<u16, String> {
    let validated = validate_project_path(&project_path)?;
    crate::static_server::start_static_server(window_label, validated.to_string_lossy().to_string())
        .await
}

/// Stop the static file server for a window.
#[tauri::command]
pub fn stop_static_server(window_label: String) -> Result<(), String> {
    crate::static_server::stop_static_server(&window_label);
    Ok(())
}
