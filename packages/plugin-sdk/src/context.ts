/**
 * Access the Ship Studio plugin context from the window global.
 *
 * The host app sets window.__SHIPSTUDIO_PLUGIN_CONTEXT__ before
 * rendering each plugin component.
 *
 * @module context
 */

/** Plugin context value matching the host app's PluginContextValue */
export interface PluginContextValue {
  pluginId: string;
  project: {
    name: string;
    path: string;
    currentBranch: string;
    hasUncommittedChanges: boolean;
  } | null;
  actions: {
    showToast: (message: string, type?: 'success' | 'error') => void;
    refreshGitStatus: () => void;
    refreshBranches: () => void;
    focusTerminal: () => void;
  };
  shell: {
    exec: (command: string, args: string[]) => Promise<{
      stdout: string;
      stderr: string;
      exit_code: number;
    }>;
  };
  storage: {
    read: (scope: 'global' | 'project') => Promise<Record<string, unknown>>;
    write: (scope: 'global' | 'project', data: Record<string, unknown>) => Promise<void>;
  };
  theme: {
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    accent: string;
  };
}

/**
 * Get the current plugin context from the host app.
 * @throws if called outside a plugin rendering context
 */
export function getPluginContext(): PluginContextValue {
  const ctx = (window as Record<string, unknown>).__SHIPSTUDIO_PLUGIN_CONTEXT__ as
    | PluginContextValue
    | undefined;
  if (!ctx) {
    throw new Error(
      '@shipstudio/plugin-sdk: Plugin context not available. ' +
        'Ensure this is called within a Ship Studio plugin component.'
    );
  }
  return ctx;
}
