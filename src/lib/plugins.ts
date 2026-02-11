/**
 * Plugin management utilities for Ship Studio.
 *
 * Provides functions for:
 * - Listing, installing, uninstalling, and updating plugins
 * - Reading plugin bundles and manifests
 * - Executing plugin shell commands
 * - Plugin-scoped storage operations
 *
 * @module lib/plugins
 */

import { invoke } from '@tauri-apps/api/core';

/** Setup item contributed by a plugin */
export interface PluginSetupItem {
  id: string;
  label: string;
  depends_on: string[];
  check_command: string;
  install_command: string;
}

/** Plugin manifest from plugin.json */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  slots: string[];
  author: string;
  repository: string;
  setup: PluginSetupItem[];
  min_app_version: string;
  icon: string;
}

/** Plugin info with registry state */
export interface PluginInfo {
  manifest: PluginManifest;
  enabled: boolean;
  installed_at: number;
  source_url: string;
}

/** Result of a plugin shell command */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

/**
 * List all installed plugins.
 */
export async function listPlugins(): Promise<PluginInfo[]> {
  return invoke<PluginInfo[]>('list_plugins');
}

/**
 * Install a plugin from a GitHub repository URL.
 */
export async function installPlugin(repoUrl: string): Promise<PluginInfo> {
  return invoke<PluginInfo>('install_plugin', { repoUrl });
}

/**
 * Uninstall a plugin by its ID.
 */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  return invoke('uninstall_plugin', { pluginId });
}

/**
 * Update a plugin to the latest version from its source.
 */
export async function updatePlugin(pluginId: string): Promise<PluginInfo> {
  return invoke<PluginInfo>('update_plugin', { pluginId });
}

/**
 * Read the JavaScript bundle source for a plugin.
 */
export async function readPluginBundle(pluginId: string): Promise<string> {
  return invoke<string>('read_plugin_bundle', { pluginId });
}

/**
 * Read a plugin's manifest.
 */
export async function readPluginManifest(pluginId: string): Promise<PluginManifest> {
  return invoke<PluginManifest>('read_plugin_manifest', { pluginId });
}

/**
 * Toggle a plugin's enabled/disabled state.
 */
export async function togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
  return invoke('toggle_plugin', { pluginId, enabled });
}

/**
 * Execute a shell command in a plugin's context.
 * Command runs in the project directory with a 30s timeout.
 */
export async function execPluginShell(
  pluginId: string,
  projectPath: string,
  command: string,
  args: string[]
): Promise<ShellResult> {
  return invoke<ShellResult>('exec_plugin_shell', { pluginId, projectPath, command, args });
}

/**
 * Read plugin storage data.
 * @param scope - "global" or "project"
 */
export async function readPluginStorage(
  pluginId: string,
  scope: 'global' | 'project',
  projectPath?: string
): Promise<Record<string, unknown>> {
  return invoke('read_plugin_storage', { pluginId, scope, projectPath });
}

/**
 * Write plugin storage data.
 * @param scope - "global" or "project"
 */
export async function writePluginStorage(
  pluginId: string,
  scope: 'global' | 'project',
  projectPath?: string,
  data?: Record<string, unknown>
): Promise<void> {
  return invoke('write_plugin_storage', { pluginId, scope, projectPath, data });
}
