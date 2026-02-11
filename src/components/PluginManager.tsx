/**
 * PluginManager component for installing, managing, and removing plugins.
 *
 * Provides two tabs:
 * - Installed: View installed plugins with enable/disable toggle and uninstall
 * - Add: Install new plugins from a GitHub repository URL
 *
 * @module components/PluginManager
 */

import { useEffect, useState, useCallback } from 'react';
import { CloseIcon } from './icons';
import {
  listPlugins,
  installPlugin,
  uninstallPlugin,
  togglePlugin,
  type PluginInfo,
} from '../lib/plugins';

type Tab = 'installed' | 'add';

interface PluginManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onPluginsChanged: () => void;
}

export function PluginManager({ isOpen, onClose, onPluginsChanged }: PluginManagerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('installed');
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Fetch plugins when modal opens
  const fetchPlugins = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listPlugins();
      setPlugins(result);
    } catch (err) {
      console.error('Failed to load plugins:', err);
      setPlugins([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchPlugins();
  }, [isOpen, fetchPlugins]);

  // Handle install
  const handleInstall = async () => {
    if (!repoUrl.trim()) return;

    setIsInstalling(true);
    setError(null);

    try {
      await installPlugin(repoUrl.trim());
      setRepoUrl('');
      await fetchPlugins();
      setActiveTab('installed');
      onPluginsChanged();
    } catch (err) {
      console.error('Failed to install plugin:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInstalling(false);
    }
  };

  // Handle uninstall
  const handleUninstall = async (pluginId: string) => {
    setRemovingId(pluginId);
    try {
      await uninstallPlugin(pluginId);
      await fetchPlugins();
      onPluginsChanged();
    } catch (err) {
      console.error('Failed to uninstall plugin:', err);
    } finally {
      setRemovingId(null);
    }
  };

  // Handle toggle
  const handleToggle = async (pluginId: string, enabled: boolean) => {
    setTogglingId(pluginId);
    try {
      await togglePlugin(pluginId, enabled);
      await fetchPlugins();
      onPluginsChanged();
    } catch (err) {
      console.error('Failed to toggle plugin:', err);
    } finally {
      setTogglingId(null);
    }
  };

  // Handle key press in URL input
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleInstall();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal plugins-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="plugins-modal-header">
          <h3>Plugins</h3>
          <button className="plugins-close-btn" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="plugins-tabs">
          <button
            className={`plugins-tab ${activeTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveTab('installed')}
          >
            Installed
          </button>
          <button
            className={`plugins-tab ${activeTab === 'add' ? 'active' : ''}`}
            onClick={() => setActiveTab('add')}
          >
            Add
          </button>
        </div>

        <div className="plugins-modal-body">
          {activeTab === 'installed' && (
            <>
              {isLoading && plugins.length === 0 && (
                <div className="plugins-loading">
                  <div className="plugins-loading-spinner" />
                  Loading plugins...
                </div>
              )}

              {!isLoading && plugins.length === 0 && (
                <div className="plugins-empty">
                  No plugins installed yet. Go to the Add tab to install one.
                </div>
              )}

              <div className="plugins-list">
                {plugins.map((plugin) => (
                  <div key={plugin.manifest.id} className="plugin-row">
                    <div className="plugin-info">
                      <div className="plugin-name">{plugin.manifest.name}</div>
                      <div className="plugin-meta">
                        <span className="plugin-version">v{plugin.manifest.version}</span>
                        {plugin.manifest.author && (
                          <span className="plugin-author">{plugin.manifest.author}</span>
                        )}
                      </div>
                      <div className="plugin-desc">{plugin.manifest.description}</div>
                      {plugin.manifest.slots.length > 0 && (
                        <div className="plugin-slots">
                          {plugin.manifest.slots.map((s) => (
                            <span key={s} className="plugin-slot-badge">
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="plugin-actions">
                      <button
                        className={`plugin-toggle-btn ${plugin.enabled ? 'enabled' : ''}`}
                        onClick={() => handleToggle(plugin.manifest.id, !plugin.enabled)}
                        disabled={togglingId === plugin.manifest.id}
                        title={plugin.enabled ? 'Disable' : 'Enable'}
                      >
                        {plugin.enabled ? 'On' : 'Off'}
                      </button>
                      <button
                        className="plugin-remove-btn"
                        onClick={() => handleUninstall(plugin.manifest.id)}
                        disabled={removingId === plugin.manifest.id}
                      >
                        {removingId === plugin.manifest.id ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'add' && (
            <>
              <div className="plugins-install-section">
                <p className="plugins-install-hint">
                  Enter a GitHub repository URL to install a plugin.
                </p>
                <div className="plugins-install-input-wrapper">
                  <input
                    type="text"
                    className="plugins-install-input"
                    placeholder="https://github.com/owner/repo"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    onKeyPress={handleKeyPress}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  <button
                    className="plugins-install-btn"
                    onClick={handleInstall}
                    disabled={isInstalling || !repoUrl.trim()}
                  >
                    {isInstalling ? 'Installing...' : 'Install'}
                  </button>
                </div>
              </div>

              {error && <div className="plugins-error">{error}</div>}
            </>
          )}
        </div>

        <div className="plugins-footer">
          <span className="plugins-footer-hint">
            Press <span className="help-shortcut">Esc</span> to close
          </span>
        </div>
      </div>
    </div>
  );
}
