/**
 * IntegrationBar — required-integrations card at the bottom of the dashboard.
 *
 * Styled as a shared .dashboard-card so it reads as part of the same stack
 * as the Coding Agents and Preferences cards. Collapsed by default — the
 * summary line ("All integrations connected" or "X/Y ready") sits inside
 * the card header, and the individual integration rows reveal on expand.
 *
 * Each row is actionable:
 *  - tools (Homebrew, Node, Git, GitHub CLI, Vercel CLI, agents) — Install when
 *    missing; coding agents additionally offer Update / Uninstall.
 *  - accounts (the *_auth rows) — Connect when signed out; Reconnect / Disconnect
 *    when signed in. System tools are never offered an uninstall (removing them
 *    would break the app), per the chosen "disconnect accounts, uninstall agents
 *    only" policy.
 *
 * @module components/IntegrationBar
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, WarningIcon, ChevronIcon, ClaudeIcon, GitHubIcon } from '../icons';
import { Spinner } from '../primitives/Spinner';
import { Button } from '../primitives/Button';
import { ModalFrame } from '../primitives/ModalFrame';
import { OnboardingTerminal } from '../setup/OnboardingTerminal';
import {
  getFullSetupStatus,
  installPackages,
  logoutGithub,
  logoutVercel,
  SetupItem,
  SETUP_ITEM_ORDER,
  TERMINAL_COMMANDS,
} from '../../lib/setup';
import { signOutAgent, uninstallAgent } from '../../lib/agents-management';
import { useOptionalToast } from '../../contexts/ToastContext';
import { logger } from '../../lib/logger';

/** Setup item id → coding-agent id (covers the binary row and its `_auth` row). */
const AGENT_ID_BY_ITEM: Record<string, string> = {
  claude: 'claude-code',
  claude_auth: 'claude-code',
  codex: 'codex',
  codex_auth: 'codex',
  opencode: 'opencode',
  opencode_auth: 'opencode',
};

/** The coding-agent binary rows — the only items eligible for uninstall. */
const AGENT_BINARY_ITEMS = new Set(['claude', 'codex', 'opencode']);

/** Tools installed via the package manager (direct invoke) rather than a terminal. */
const PKG_MGR_ITEMS = new Set(['node', 'git', 'gh']);

const isAccountItem = (id: string) => id.endsWith('_auth');

function KebabGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="2.5" cy="7" r="1.3" fill="currentColor" />
      <circle cx="7" cy="7" r="1.3" fill="currentColor" />
      <circle cx="11.5" cy="7" r="1.3" fill="currentColor" />
    </svg>
  );
}

interface IntegrationBarProps {
  /** Optional friendly browser GitHub-connect flow (falls back to the terminal). */
  onGitHubConnect?: () => void;
}

interface TerminalTask {
  itemId: string;
  title: string;
  command: string;
  args: string[];
}

interface UninstallConfirm {
  itemId: string;
  agentId: string;
  name: string;
}

export function IntegrationBar({ onGitHubConnect }: IntegrationBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [setupItems, setSetupItems] = useState<SetupItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [terminalTask, setTerminalTask] = useState<TerminalTask | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<UninstallConfirm | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const { showToast } = useOptionalToast();

  // Stable showToast identity so refresh() doesn't re-fire the mount effect when
  // there's no ToastProvider (useOptionalToast returns a fresh object per render).
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const refresh = useCallback(async () => {
    try {
      const status = await getFullSetupStatus();
      const sorted = [...status.items].sort(
        (a, b) => SETUP_ITEM_ORDER.indexOf(a.id) - SETUP_ITEM_ORDER.indexOf(b.id)
      );
      setSetupItems(sorted);
    } catch (error) {
      logger.error('Failed to load setup status', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Close the kebab menu on outside click.
  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [openMenuId]);

  // Auth/install files (and newly-installed binaries) can land a beat after the
  // action finishes — refresh now and retry a few times so the row settles.
  const scheduleRefresh = useCallback(() => {
    void refresh();
    [600, 1500, 3000].forEach((delay) => setTimeout(() => void refresh(), delay));
  }, [refresh]);

  const openTerminal = useCallback((item: SetupItem) => {
    setOpenMenuId(null);
    const cmd = TERMINAL_COMMANDS[item.id];
    if (!cmd) return;
    setTerminalTask({
      itemId: item.id,
      title: item.friendlyName,
      command: cmd.command,
      args: cmd.args,
    });
  }, []);

  const handleTerminalExit = useCallback(() => {
    setTerminalTask(null);
    scheduleRefresh();
  }, [scheduleRefresh]);

  const runInstall = useCallback(
    async (item: SetupItem) => {
      setOpenMenuId(null);
      if (!PKG_MGR_ITEMS.has(item.id)) {
        openTerminal(item); // homebrew, agents, vercel, npm_fix
        return;
      }
      if (busy) return;
      setBusy(item.id);
      try {
        await installPackages([item.id]);
        showToast(`Installed ${item.friendlyName}`, 'success');
        scheduleRefresh();
      } catch (err) {
        showToast(`Install failed: ${String(err)}`, 'error');
      } finally {
        setBusy(null);
      }
    },
    [busy, openTerminal, scheduleRefresh, showToast]
  );

  const runConnect = useCallback(
    (item: SetupItem) => {
      setOpenMenuId(null);
      if (item.id === 'gh_auth' && onGitHubConnect) {
        onGitHubConnect();
        scheduleRefresh();
        return;
      }
      openTerminal(item); // claude_auth / codex_auth / opencode_auth / vercel_auth (gh_auth fallback)
    },
    [onGitHubConnect, openTerminal, scheduleRefresh]
  );

  const runDisconnect = useCallback(
    async (item: SetupItem) => {
      setOpenMenuId(null);
      if (busy) return;
      setBusy(item.id);
      try {
        if (item.id === 'gh_auth') {
          await logoutGithub();
        } else if (item.id === 'vercel_auth') {
          await logoutVercel();
        } else {
          const agentId = AGENT_ID_BY_ITEM[item.id];
          if (agentId) await signOutAgent(agentId);
        }
        showToast(`Disconnected ${item.friendlyName}`, 'success');
        scheduleRefresh();
      } catch (err) {
        showToast(`Disconnect failed: ${String(err)}`, 'error');
      } finally {
        setBusy(null);
      }
    },
    [busy, scheduleRefresh, showToast]
  );

  const runUninstall = useCallback(
    async ({ itemId, agentId, name }: UninstallConfirm) => {
      setConfirmUninstall(null);
      setBusy(itemId);
      try {
        await uninstallAgent(agentId);
        showToast(`Uninstalled ${name}`, 'success');
        scheduleRefresh();
      } catch (err) {
        showToast(`Uninstall failed: ${String(err)}`, 'error');
      } finally {
        setBusy(null);
      }
    },
    [scheduleRefresh, showToast]
  );

  const readyCount = setupItems.filter((item) => item.status === 'ready').length;
  const totalCount = setupItems.length;
  const allConnected = totalCount > 0 && readyCount === totalCount;

  const getItemIcon = (itemId: string) => {
    switch (itemId) {
      case 'claude':
      case 'claude_auth':
        return <ClaudeIcon />;
      case 'gh':
      case 'gh_auth':
        return <GitHubIcon />;
      default:
        return <CheckIcon size={16} />;
    }
  };

  const getStatusText = (item: SetupItem) => {
    if (item.status === 'ready') {
      return item.username || item.version || 'Ready';
    }
    if (item.status === 'in_progress') return 'Working…';
    if (item.status === 'error') return item.errorMessage || 'Error';
    return item.status === 'not_installed' ? 'Not installed' : 'Not connected';
  };

  const subtitle = isLoading
    ? 'Checking…'
    : allConnected
      ? 'All integrations connected'
      : `${readyCount}/${totalCount} ready`;

  const statusIcon = isLoading ? (
    <Spinner size="sm" />
  ) : allConnected ? (
    <CheckIcon size={14} className="integration-bar-status-icon success" />
  ) : (
    <WarningIcon size={14} className="integration-bar-status-icon warning" />
  );

  return (
    <section
      ref={panelRef}
      className={`dashboard-card integration-bar ${isExpanded ? 'is-expanded' : ''}`}
      data-education-id="integration-bar"
    >
      <button
        type="button"
        className="dashboard-card-header integration-bar-header-btn"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
      >
        <div>
          <h3 className="dashboard-card-title">Integrations</h3>
          <p className="dashboard-card-subtitle integration-bar-subtitle">
            {statusIcon}
            <span>{subtitle}</span>
          </p>
        </div>
        <ChevronIcon
          size={14}
          className={`integration-bar-chevron ${isExpanded ? 'up' : 'down'}`}
        />
      </button>

      {isExpanded && (
        <div className="dashboard-card-rows">
          {setupItems.map((item) => {
            const account = isAccountItem(item.id);
            const ready = item.status === 'ready';
            const isBusy = busy === item.id;
            const inProgress = item.status === 'in_progress' || isBusy;
            const isAgentBinary = AGENT_BINARY_ITEMS.has(item.id);
            const needsInstall =
              !account && (item.status === 'not_installed' || item.status === 'error');
            const needsConnect =
              account && (item.status === 'not_authenticated' || item.status === 'error');
            const showMenu = ready && (account || isAgentBinary);
            const menuOpen = openMenuId === item.id;

            return (
              <div key={item.id} className="dashboard-card-row">
                <div className={`dashboard-card-row-icon ${ready ? 'success' : ''}`}>
                  {getItemIcon(item.id)}
                </div>
                <div className="dashboard-card-row-main">
                  <span className="dashboard-card-row-name">{item.friendlyName}</span>
                  <span className={`dashboard-card-row-status ${ready ? 'success' : ''}`}>
                    {getStatusText(item)}
                  </span>
                </div>

                <div className="agents-panel-row-actions">
                  {inProgress && <Spinner size="sm" />}

                  {!inProgress && needsInstall && (
                    <Button variant="primary" size="sm" onClick={() => void runInstall(item)}>
                      Install
                    </Button>
                  )}

                  {!inProgress && needsConnect && (
                    <Button variant="primary" size="sm" onClick={() => runConnect(item)}>
                      Connect
                    </Button>
                  )}

                  {!inProgress && showMenu && (
                    <div className="agents-panel-menu-wrap">
                      <button
                        type="button"
                        className="agents-panel-kebab"
                        onClick={() => setOpenMenuId(menuOpen ? null : item.id)}
                        title={`More actions for ${item.friendlyName}`}
                        aria-label={`More actions for ${item.friendlyName}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                      >
                        <KebabGlyph />
                      </button>
                      {menuOpen && (
                        <div className="agents-panel-menu" role="menu">
                          {account && (
                            <button type="button" role="menuitem" onClick={() => runConnect(item)}>
                              Reconnect
                            </button>
                          )}
                          {account && (
                            <button
                              type="button"
                              role="menuitem"
                              className="agents-panel-menu-danger"
                              onClick={() => void runDisconnect(item)}
                            >
                              Disconnect
                            </button>
                          )}
                          {isAgentBinary && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => openTerminal(item)}
                            >
                              Update
                            </button>
                          )}
                          {isAgentBinary && (
                            <button
                              type="button"
                              role="menuitem"
                              className="agents-panel-menu-danger"
                              onClick={() => {
                                setOpenMenuId(null);
                                setConfirmUninstall({
                                  itemId: item.id,
                                  agentId: AGENT_ID_BY_ITEM[item.id],
                                  name: item.friendlyName,
                                });
                              }}
                            >
                              Uninstall
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {terminalTask && (
        <ModalFrame
          isOpen
          onClose={handleTerminalExit}
          title={terminalTask.title}
          className="agents-panel-terminal-modal"
        >
          <div className="agents-panel-terminal-body">
            <OnboardingTerminal
              command={terminalTask.command}
              args={terminalTask.args}
              onExit={handleTerminalExit}
            />
          </div>
        </ModalFrame>
      )}

      {confirmUninstall && (
        <ModalFrame
          isOpen
          onClose={() => setConfirmUninstall(null)}
          title={`Uninstall ${confirmUninstall.name}?`}
          className="agents-panel-confirm-modal"
        >
          <div className="agents-panel-confirm-body">
            <p>
              This removes the {confirmUninstall.name} CLI from your machine. You can reinstall it
              any time from this panel.
            </p>
            <div className="agents-panel-confirm-actions">
              <Button variant="secondary" onClick={() => setConfirmUninstall(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void runUninstall(confirmUninstall)}>
                Uninstall
              </Button>
            </div>
          </div>
        </ModalFrame>
      )}
    </section>
  );
}
