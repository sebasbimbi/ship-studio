/**
 * Ship Studio Plugin SDK
 *
 * Provides hooks and types for building Ship Studio plugins.
 *
 * Plugins use this SDK to access the host app's context, execute shell commands,
 * show toast notifications, and persist data — all without direct Tauri invoke access.
 *
 * @module @shipstudio/plugin-sdk
 */

// Context
export { getPluginContext, type PluginContextValue } from './context';

// Hooks
export { useProject } from './hooks/useProject';
export { useShell } from './hooks/useShell';
export { useToast } from './hooks/useToast';
export { usePluginStorage } from './hooks/usePluginStorage';
export { useAppActions } from './hooks/useAppActions';
export { useTheme } from './hooks/useTheme';
