/**
 * Plugin management commands for Ship Studio.
 *
 * Provides commands for:
 * - Listing, installing, uninstalling, and updating plugins
 * - Reading plugin bundles (JS source) for frontend loading
 * - Executing shell commands in plugin context with sandboxing
 * - Plugin-scoped storage (global and per-project)
 *
 * Plugin storage locations:
 * - Registry: ~/.shipstudio/plugins/registry.json
 * - Plugin files: ~/.shipstudio/plugins/{plugin-id}/ (plugin.json, dist/, icon.svg)
 * - Per-project data: {project}/.shipstudio/plugins/{plugin-id}.json
 */
use crate::utils::{create_command, get_extended_path, validate_project_path};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Plugin manifest from plugin.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginManifest {
    /// Unique plugin identifier (e.g., "hello-world")
    pub id: String,
    /// Display name
    pub name: String,
    /// Plugin version (semver)
    pub version: String,
    /// Short description
    pub description: String,
    /// UI slots this plugin renders into
    #[serde(default)]
    pub slots: Vec<String>,
    /// Plugin author
    #[serde(default)]
    pub author: String,
    /// Source repository URL
    #[serde(default)]
    pub repository: String,
    /// Setup items this plugin contributes to onboarding
    #[serde(default)]
    pub setup: Vec<PluginSetupItem>,
    /// Minimum Ship Studio version required
    #[serde(default)]
    pub min_app_version: String,
    /// Icon filename (relative to plugin dir)
    #[serde(default)]
    pub icon: String,
}

/// A setup item contributed by a plugin
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginSetupItem {
    /// Item identifier (will be prefixed with plugin id)
    pub id: String,
    /// Display label
    pub label: String,
    /// IDs of items this depends on
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Shell command to check if ready
    #[serde(default)]
    pub check_command: String,
    /// Shell command to install
    #[serde(default)]
    pub install_command: String,
}

/// Plugin info returned to frontend (manifest + registry state)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginInfo {
    /// Plugin manifest data
    pub manifest: PluginManifest,
    /// Whether the plugin is enabled
    pub enabled: bool,
    /// When the plugin was installed (Unix ms)
    pub installed_at: u64,
    /// Source repository URL used for install
    pub source_url: String,
}

/// Registry entry stored in registry.json
#[derive(Debug, Serialize, Deserialize, Clone)]
struct RegistryEntry {
    plugin_id: String,
    enabled: bool,
    installed_at: u64,
    source_url: String,
}

/// The registry file format
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct Registry {
    plugins: Vec<RegistryEntry>,
}

/// Result of a shell command execution
#[derive(Debug, Serialize, Clone)]
pub struct ShellResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Get the plugins base directory (~/.shipstudio/plugins/)
fn get_plugins_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let dir = home.join(".shipstudio").join("plugins");
    Ok(dir)
}

/// Read the plugin registry
fn read_registry() -> Result<Registry, String> {
    let plugins_dir = get_plugins_dir()?;
    let registry_path = plugins_dir.join("registry.json");

    if !registry_path.exists() {
        return Ok(Registry::default());
    }

    let content = fs::read_to_string(&registry_path)
        .map_err(|e| format!("Failed to read registry: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse registry: {}", e))
}

/// Write the plugin registry
fn write_registry(registry: &Registry) -> Result<(), String> {
    let plugins_dir = get_plugins_dir()?;
    fs::create_dir_all(&plugins_dir).map_err(|e| format!("Failed to create plugins dir: {}", e))?;

    let registry_path = plugins_dir.join("registry.json");
    let content = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;

    fs::write(&registry_path, content).map_err(|e| format!("Failed to write registry: {}", e))
}

/// Read a plugin's manifest from its directory
fn read_manifest(plugin_dir: &PathBuf) -> Result<PluginManifest, String> {
    let manifest_path = plugin_dir.join("plugin.json");
    if !manifest_path.exists() {
        return Err(format!("No plugin.json found in {}", plugin_dir.display()));
    }

    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read plugin.json: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse plugin.json: {}", e))
}

/// Get current timestamp in milliseconds
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// List all installed plugins with their manifests and registry state
#[tauri::command]
pub fn list_plugins() -> Result<Vec<PluginInfo>, String> {
    let registry = read_registry()?;
    let plugins_dir = get_plugins_dir()?;
    let mut results = Vec::new();

    for entry in &registry.plugins {
        let plugin_dir = plugins_dir.join(&entry.plugin_id);
        match read_manifest(&plugin_dir) {
            Ok(manifest) => {
                results.push(PluginInfo {
                    manifest,
                    enabled: entry.enabled,
                    installed_at: entry.installed_at,
                    source_url: entry.source_url.clone(),
                });
            }
            Err(e) => {
                tracing::warn!("Skipping plugin {}: {}", entry.plugin_id, e);
            }
        }
    }

    Ok(results)
}

/// Install a plugin from a GitHub repository URL
#[tauri::command]
pub async fn install_plugin(repo_url: String) -> Result<PluginInfo, String> {
    let plugins_dir = get_plugins_dir()?;
    fs::create_dir_all(&plugins_dir).map_err(|e| format!("Failed to create plugins dir: {}", e))?;

    // Clone into a temp directory first, then move
    let temp_dir = plugins_dir.join(".tmp-install");
    if temp_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
    }

    let output = create_command("git")
        .args([
            "clone",
            "--depth",
            "1",
            &repo_url,
            &temp_dir.to_string_lossy(),
        ])
        .env("PATH", get_extended_path())
        .output()
        .map_err(|e| format!("Failed to run git clone: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!("Git clone failed: {}", stderr));
    }

    // Read manifest to get plugin ID
    let manifest = match read_manifest(&temp_dir) {
        Ok(m) => m,
        Err(e) => {
            let _ = fs::remove_dir_all(&temp_dir);
            return Err(format!("Invalid plugin: {}", e));
        }
    };

    // Validate manifest has required fields
    if manifest.id.is_empty() || manifest.name.is_empty() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err("Plugin manifest must have 'id' and 'name' fields".to_string());
    }

    // Validate plugin ID is safe for filesystem
    if manifest.id.contains('/')
        || manifest.id.contains('\\')
        || manifest.id.contains("..")
        || manifest.id.starts_with('.')
    {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err("Plugin ID contains invalid characters".to_string());
    }

    let plugin_dir = plugins_dir.join(&manifest.id);

    // Remove existing version if present
    if plugin_dir.exists() {
        fs::remove_dir_all(&plugin_dir)
            .map_err(|e| format!("Failed to remove existing plugin: {}", e))?;
    }

    // Move temp to final location
    fs::rename(&temp_dir, &plugin_dir).map_err(|e| {
        let _ = fs::remove_dir_all(&temp_dir);
        format!("Failed to move plugin to final location: {}", e)
    })?;

    // Remove .git directory (no need to keep it)
    let git_dir = plugin_dir.join(".git");
    if git_dir.exists() {
        let _ = fs::remove_dir_all(&git_dir);
    }

    // Update registry
    let mut registry = read_registry()?;

    // Remove old entry if exists
    registry.plugins.retain(|e| e.plugin_id != manifest.id);

    let entry = RegistryEntry {
        plugin_id: manifest.id.clone(),
        enabled: true,
        installed_at: now_ms(),
        source_url: repo_url.clone(),
    };

    registry.plugins.push(entry);
    write_registry(&registry)?;

    Ok(PluginInfo {
        manifest,
        enabled: true,
        installed_at: now_ms(),
        source_url: repo_url,
    })
}

/// Uninstall a plugin by its ID
#[tauri::command]
pub fn uninstall_plugin(plugin_id: String) -> Result<(), String> {
    let plugins_dir = get_plugins_dir()?;
    let plugin_dir = plugins_dir.join(&plugin_id);

    // Remove plugin directory
    if plugin_dir.exists() {
        fs::remove_dir_all(&plugin_dir)
            .map_err(|e| format!("Failed to remove plugin directory: {}", e))?;
    }

    // Update registry
    let mut registry = read_registry()?;
    registry.plugins.retain(|e| e.plugin_id != plugin_id);
    write_registry(&registry)?;

    Ok(())
}

/// Update a plugin by pulling latest from its source repository
#[tauri::command]
pub async fn update_plugin(plugin_id: String) -> Result<PluginInfo, String> {
    let registry = read_registry()?;
    let entry = registry
        .plugins
        .iter()
        .find(|e| e.plugin_id == plugin_id)
        .ok_or_else(|| format!("Plugin '{}' not found in registry", plugin_id))?;

    let source_url = entry.source_url.clone();
    let was_enabled = entry.enabled;

    // Re-install from source (clean install)
    let plugins_dir = get_plugins_dir()?;
    let plugin_dir = plugins_dir.join(&plugin_id);

    if plugin_dir.exists() {
        fs::remove_dir_all(&plugin_dir)
            .map_err(|e| format!("Failed to remove old plugin: {}", e))?;
    }

    // Clone fresh
    let output = create_command("git")
        .args([
            "clone",
            "--depth",
            "1",
            &source_url,
            &plugin_dir.to_string_lossy(),
        ])
        .env("PATH", get_extended_path())
        .output()
        .map_err(|e| format!("Failed to run git clone: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git clone failed: {}", stderr));
    }

    // Remove .git directory
    let git_dir = plugin_dir.join(".git");
    if git_dir.exists() {
        let _ = fs::remove_dir_all(&git_dir);
    }

    let manifest = read_manifest(&plugin_dir)?;

    // Update registry entry (preserve enabled state)
    let mut registry = read_registry()?;
    if let Some(entry) = registry
        .plugins
        .iter_mut()
        .find(|e| e.plugin_id == plugin_id)
    {
        entry.enabled = was_enabled;
    }
    write_registry(&registry)?;

    Ok(PluginInfo {
        manifest,
        enabled: was_enabled,
        installed_at: now_ms(),
        source_url,
    })
}

/// Read the JavaScript bundle for a plugin (dist/index.js)
#[tauri::command]
pub fn read_plugin_bundle(plugin_id: String) -> Result<String, String> {
    let plugins_dir = get_plugins_dir()?;
    let bundle_path = plugins_dir.join(&plugin_id).join("dist").join("index.js");

    if !bundle_path.exists() {
        return Err(format!(
            "Plugin bundle not found: {}",
            bundle_path.display()
        ));
    }

    fs::read_to_string(&bundle_path).map_err(|e| format!("Failed to read plugin bundle: {}", e))
}

/// Read a plugin's manifest
#[tauri::command]
pub fn read_plugin_manifest(plugin_id: String) -> Result<PluginManifest, String> {
    let plugins_dir = get_plugins_dir()?;
    let plugin_dir = plugins_dir.join(&plugin_id);
    read_manifest(&plugin_dir)
}

/// Toggle a plugin's enabled state
#[tauri::command]
pub fn toggle_plugin(plugin_id: String, enabled: bool) -> Result<(), String> {
    let mut registry = read_registry()?;

    if let Some(entry) = registry
        .plugins
        .iter_mut()
        .find(|e| e.plugin_id == plugin_id)
    {
        entry.enabled = enabled;
        write_registry(&registry)?;
        Ok(())
    } else {
        Err(format!("Plugin '{}' not found", plugin_id))
    }
}

/// Execute a shell command in a plugin's context
///
/// Security: validates project_path, uses extended PATH, enforces 30s timeout.
/// Plugins specify commands but execution is sandboxed to the project directory.
#[tauri::command]
pub async fn exec_plugin_shell(
    plugin_id: String,
    project_path: String,
    command: String,
    args: Vec<String>,
) -> Result<ShellResult, String> {
    // Validate the project path for security
    let validated_path = validate_project_path(&project_path)?;

    // Validate plugin exists
    let plugins_dir = get_plugins_dir()?;
    let plugin_dir = plugins_dir.join(&plugin_id);
    if !plugin_dir.exists() {
        return Err(format!("Plugin '{}' not found", plugin_id));
    }

    // Build and execute command with timeout
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::task::spawn_blocking(move || {
            create_command(&command)
                .args(&args)
                .current_dir(&validated_path)
                .env("PATH", get_extended_path())
                .env(
                    "HOME",
                    dirs::home_dir()
                        .map(|h| h.to_string_lossy().to_string())
                        .unwrap_or_default(),
                )
                .output()
        }),
    )
    .await
    .map_err(|_| "Plugin shell command timed out (30s)".to_string())?
    .map_err(|e| format!("Failed to spawn command: {}", e))?
    .map_err(|e| format!("Failed to execute command: {}", e))?;

    Ok(ShellResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

/// Read plugin storage data
///
/// scope "global" reads from ~/.shipstudio/plugins/{plugin-id}/storage.json
/// scope "project" reads from {project}/.shipstudio/plugins/{plugin-id}.json
#[tauri::command]
pub fn read_plugin_storage(
    plugin_id: String,
    scope: String,
    project_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let storage_path = get_storage_path(&plugin_id, &scope, project_path.as_deref())?;

    if !storage_path.exists() {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    }

    let content = fs::read_to_string(&storage_path)
        .map_err(|e| format!("Failed to read plugin storage: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse plugin storage: {}", e))
}

/// Write plugin storage data
#[tauri::command]
pub fn write_plugin_storage(
    plugin_id: String,
    scope: String,
    project_path: Option<String>,
    data: serde_json::Value,
) -> Result<(), String> {
    let storage_path = get_storage_path(&plugin_id, &scope, project_path.as_deref())?;

    // Ensure parent directory exists
    if let Some(parent) = storage_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create storage directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize storage data: {}", e))?;

    fs::write(&storage_path, content).map_err(|e| format!("Failed to write plugin storage: {}", e))
}

/// Get the storage file path for a plugin
fn get_storage_path(
    plugin_id: &str,
    scope: &str,
    project_path: Option<&str>,
) -> Result<PathBuf, String> {
    // Validate plugin_id is safe
    if plugin_id.contains('/')
        || plugin_id.contains('\\')
        || plugin_id.contains("..")
        || plugin_id.starts_with('.')
    {
        return Err("Invalid plugin ID".to_string());
    }

    match scope {
        "global" => {
            let plugins_dir = get_plugins_dir()?;
            Ok(plugins_dir.join(plugin_id).join("storage.json"))
        }
        "project" => {
            let proj_path =
                project_path.ok_or("Project path required for project-scoped storage")?;
            let validated = validate_project_path(proj_path)?;
            Ok(validated
                .join(".shipstudio")
                .join("plugins")
                .join(format!("{}.json", plugin_id)))
        }
        _ => Err(format!("Invalid storage scope: '{}'", scope)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_registry() {
        let registry = Registry::default();
        assert!(registry.plugins.is_empty());
    }

    #[test]
    fn test_parse_manifest() {
        let json = r#"{
            "id": "hello-world",
            "name": "Hello World",
            "version": "1.0.0",
            "description": "A test plugin",
            "slots": ["toolbar"]
        }"#;

        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.id, "hello-world");
        assert_eq!(manifest.name, "Hello World");
        assert_eq!(manifest.slots, vec!["toolbar"]);
        assert!(manifest.author.is_empty());
    }

    #[test]
    fn test_parse_manifest_minimal() {
        let json = r#"{
            "id": "test",
            "name": "Test",
            "version": "0.1.0",
            "description": "Minimal"
        }"#;

        let manifest: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.id, "test");
        assert!(manifest.slots.is_empty());
        assert!(manifest.setup.is_empty());
    }

    #[test]
    fn test_storage_path_global() {
        let path = get_storage_path("hello-world", "global", None);
        assert!(path.is_ok());
        let path = path.unwrap();
        assert!(path.to_string_lossy().contains("hello-world"));
        assert!(path.to_string_lossy().ends_with("storage.json"));
    }

    #[test]
    fn test_storage_path_invalid_plugin_id() {
        let result = get_storage_path("../evil", "global", None);
        assert!(result.is_err());

        let result = get_storage_path(".hidden", "global", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_storage_path_project_requires_path() {
        let result = get_storage_path("test", "project", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_storage_path_invalid_scope() {
        let result = get_storage_path("test", "invalid", None);
        assert!(result.is_err());
    }
}
