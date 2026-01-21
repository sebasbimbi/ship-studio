import { useState } from "react";
import { GitHubState, VercelState, ClaudeState } from "../App";
import { CheckIcon, WarningIcon, ChevronIcon, ClaudeIcon, GitHubIcon, VercelIcon } from "./icons";

interface IntegrationBarProps {
  githubState: GitHubState;
  vercelState: VercelState;
  claudeState: ClaudeState;
  onGitHubConnect: () => void;
  onVercelConnect: () => void;
  onClaudeConnect: () => void;
  isInstallingClaude?: boolean;
  isInstallingVercel?: boolean;
}

export function IntegrationBar({
  githubState,
  vercelState,
  claudeState,
  onGitHubConnect,
  onVercelConnect,
  onClaudeConnect,
  isInstallingClaude = false,
  isInstallingVercel = false,
}: IntegrationBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const claudeConnected = claudeState.cliStatus.installed;
  const githubConnected = githubState.cliStatus.authenticated;
  const vercelConnected = vercelState.cliStatus.authenticated;

  const allConnected = claudeConnected && githubConnected && vercelConnected;
  const connectedCount = [claudeConnected, githubConnected, vercelConnected].filter(Boolean).length;

  return (
    <div className={`integration-bar ${isExpanded ? "expanded" : ""}`}>
      <button
        className="integration-bar-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {allConnected ? (
          <>
            <CheckIcon size={16} className="integration-bar-icon success" />
            <span>All integrations connected</span>
          </>
        ) : (
          <>
            <WarningIcon size={16} className="integration-bar-icon warning" />
            <span>{connectedCount}/3 integrations connected</span>
          </>
        )}
        <ChevronIcon size={16} className={`integration-bar-chevron ${isExpanded ? "up" : "down"}`} />
      </button>

      {isExpanded && (
        <div className="integration-bar-content">
          {/* Claude */}
          <div className={`integration-bar-item ${claudeConnected ? "connected" : ""}`}>
            <div className="integration-bar-item-icon">
              <ClaudeIcon />
            </div>
            <div className="integration-bar-item-info">
              <span className="integration-bar-item-name">Claude</span>
              {claudeConnected ? (
                <span className="integration-bar-item-status success">
                  {claudeState.cliStatus.version || "Connected"}
                </span>
              ) : (
                <span className="integration-bar-item-status">Not installed</span>
              )}
            </div>
            {!claudeConnected && (
              <button
                className="integration-bar-item-action"
                onClick={onClaudeConnect}
                disabled={isInstallingClaude}
              >
                {isInstallingClaude ? "Installing..." : "Install"}
              </button>
            )}
          </div>

          {/* GitHub */}
          <div className={`integration-bar-item ${githubConnected ? "connected" : ""}`}>
            <div className="integration-bar-item-icon">
              <GitHubIcon />
            </div>
            <div className="integration-bar-item-info">
              <span className="integration-bar-item-name">GitHub</span>
              {!githubState.cliStatus.installed ? (
                <span className="integration-bar-item-status">CLI not installed</span>
              ) : !githubState.cliStatus.authenticated ? (
                <span className="integration-bar-item-status">Not connected</span>
              ) : (
                <span className="integration-bar-item-status success">
                  {githubState.username}
                </span>
              )}
            </div>
            {!githubState.cliStatus.installed ? (
              <a
                href="https://cli.github.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="integration-bar-item-action"
              >
                Install
              </a>
            ) : !githubState.cliStatus.authenticated ? (
              <button
                className="integration-bar-item-action"
                onClick={onGitHubConnect}
              >
                Connect
              </button>
            ) : null}
          </div>

          {/* Vercel */}
          <div className={`integration-bar-item ${vercelConnected ? "connected" : ""}`}>
            <div className="integration-bar-item-icon">
              <VercelIcon size={16} />
            </div>
            <div className="integration-bar-item-info">
              <span className="integration-bar-item-name">Vercel</span>
              {!vercelState.cliStatus.installed ? (
                <span className="integration-bar-item-status">CLI not installed</span>
              ) : !vercelState.cliStatus.authenticated ? (
                <span className="integration-bar-item-status">Not connected</span>
              ) : (
                <span className="integration-bar-item-status success">
                  {vercelState.username || "Connected"}
                </span>
              )}
            </div>
            {!vercelState.cliStatus.installed ? (
              <button
                className="integration-bar-item-action"
                onClick={onVercelConnect}
                disabled={isInstallingVercel}
              >
                {isInstallingVercel ? "Installing..." : "Install"}
              </button>
            ) : !vercelState.cliStatus.authenticated ? (
              <button
                className="integration-bar-item-action"
                onClick={onVercelConnect}
              >
                Connect
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
