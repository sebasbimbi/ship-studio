/**
 * Plugin context for providing host app data and actions to plugins.
 *
 * Plugins render inside a PluginContext.Provider and access data through
 * SDK hooks that read from this context. Plugins never get direct `invoke`
 * access -- all backend operations go through proxy functions.
 *
 * @module contexts/PluginContext
 */

import { createContext } from 'react';

/** Project data exposed to plugins */
export interface PluginProjectData {
  name: string;
  path: string;
  currentBranch: string;
  hasUncommittedChanges: boolean;
}

/** App actions plugins can trigger */
export interface PluginAppActions {
  showToast: (message: string, type?: 'success' | 'error') => void;
  refreshGitStatus: () => void;
  refreshBranches: () => void;
  focusTerminal: () => void;
}

/** Shell command proxy for plugins */
export interface PluginShellProxy {
  exec: (
    command: string,
    args: string[]
  ) => Promise<{
    stdout: string;
    stderr: string;
    exit_code: number;
  }>;
}

/** Storage proxy for plugins */
export interface PluginStorageProxy {
  read: (scope: 'global' | 'project') => Promise<Record<string, unknown>>;
  write: (scope: 'global' | 'project', data: Record<string, unknown>) => Promise<void>;
}

/** Theme data for consistent styling */
export interface PluginThemeData {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  accent: string;
}

/** Full context value provided to each plugin */
export interface PluginContextValue {
  pluginId: string;
  project: PluginProjectData | null;
  actions: PluginAppActions;
  shell: PluginShellProxy;
  storage: PluginStorageProxy;
  theme: PluginThemeData;
}

export const PluginContext = createContext<PluginContextValue | null>(null);

/**
 * Expose the current plugin context value on window for SDK access.
 * The SDK package reads from this global to provide hooks.
 */
export function exposePluginContext(value: PluginContextValue | null): void {
  (window as unknown as Record<string, unknown>).__SHIPSTUDIO_PLUGIN_CONTEXT__ = value;
}
