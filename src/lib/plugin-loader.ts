/**
 * Plugin module loader for Ship Studio.
 *
 * Handles dynamic loading of plugin JavaScript bundles using Blob URLs
 * (since Tauri WebKit doesn't support import() of local filesystem paths).
 *
 * Also exposes React globals for plugins to use without bundling their own copy.
 *
 * @module lib/plugin-loader
 */

import { readPluginBundle } from './plugins';

/** A component that a plugin registers for a specific UI slot */
export type SlotComponent = React.ComponentType<Record<string, never>>;

/** The module interface that plugins must export */
export interface PluginModule {
  /** Plugin display name */
  name: string;
  /** Map of slot names to React components */
  slots: Record<string, SlotComponent>;
  /** Called when the plugin is activated */
  onActivate?: () => void;
  /** Called when the plugin is deactivated */
  onDeactivate?: () => void;
}

/** Cache of loaded plugin modules */
const moduleCache = new Map<string, PluginModule>();

/** Cache of blob URLs for cleanup */
const blobUrlCache = new Map<string, string>();

/**
 * Load a plugin's JavaScript module via Blob URL + dynamic import.
 *
 * 1. Reads dist/index.js from the filesystem via Rust backend
 * 2. Creates a Blob URL from the source
 * 3. Dynamic imports the Blob URL
 * 4. Caches the result
 */
export async function loadPluginModule(pluginId: string): Promise<PluginModule> {
  // Return cached module if available
  const cached = moduleCache.get(pluginId);
  if (cached) return cached;

  // Read JS bundle source from backend
  const source = await readPluginBundle(pluginId);

  // Create Blob URL for dynamic import
  const blob = new Blob([source], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  blobUrlCache.set(pluginId, blobUrl);

  try {
    // Dynamic import the blob URL
    const mod = await import(/* @vite-ignore */ blobUrl);

    // Validate module exports
    const pluginModule: PluginModule = {
      name: mod.name || pluginId,
      slots: mod.slots || {},
      onActivate: typeof mod.onActivate === 'function' ? mod.onActivate : undefined,
      onDeactivate: typeof mod.onDeactivate === 'function' ? mod.onDeactivate : undefined,
    };

    moduleCache.set(pluginId, pluginModule);

    // Call onActivate lifecycle hook
    if (pluginModule.onActivate) {
      try {
        pluginModule.onActivate();
      } catch (e) {
        console.error(`Plugin ${pluginId} onActivate failed:`, e);
      }
    }

    return pluginModule;
  } catch (e) {
    // Clean up blob URL on failure
    URL.revokeObjectURL(blobUrl);
    blobUrlCache.delete(pluginId);
    throw new Error(`Failed to load plugin ${pluginId}: ${e}`);
  }
}

/**
 * Unload a plugin module, cleaning up its Blob URL and cache entry.
 */
export function unloadPluginModule(pluginId: string): void {
  const mod = moduleCache.get(pluginId);
  if (mod?.onDeactivate) {
    try {
      mod.onDeactivate();
    } catch (e) {
      console.error(`Plugin ${pluginId} onDeactivate failed:`, e);
    }
  }

  moduleCache.delete(pluginId);

  const blobUrl = blobUrlCache.get(pluginId);
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrlCache.delete(pluginId);
  }
}

/**
 * Expose React and ReactDOM as window globals for plugins.
 *
 * Plugins mark react/react-dom as externals that resolve to these globals,
 * avoiding duplicate React instances.
 *
 * Must be called before any plugins are loaded (in main.tsx).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function exposeReactGlobals(React: any, ReactDOM: any): void {
  (window as unknown as Record<string, unknown>).__SHIPSTUDIO_REACT__ = React;
  (window as unknown as Record<string, unknown>).__SHIPSTUDIO_REACT_DOM__ = ReactDOM;
}
