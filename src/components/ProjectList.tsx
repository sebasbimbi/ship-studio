import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitHubState, VercelState, ClaudeState } from "../App";
import { installVercelCli, checkVercelCliStatus } from "../lib/vercel";
import { installClaudeCli } from "../lib/claude";

interface Project {
  name: string;
  path: string;
  thumbnail: string | null;
}

interface ProjectWithThumbnail extends Project {
  thumbnailData: string | null;
}

interface ProjectListProps {
  onSelectProject: (project: Project) => void;
  onCreateProject: () => void;
  githubState: GitHubState;
  vercelState: VercelState;
  claudeState: ClaudeState;
  onGitHubConnect: () => void;
  onVercelConnect: () => void;
  onClaudeConnect: () => void;
}

export function ProjectList({
  onSelectProject,
  onCreateProject,
  githubState,
  vercelState,
  claudeState,
  onGitHubConnect,
  onVercelConnect,
  onClaudeConnect,
}: ProjectListProps) {
  const [projects, setProjects] = useState<ProjectWithThumbnail[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Vercel login modal state
  const [showVercelLogin, setShowVercelLogin] = useState(false);
  const [vercelLoginOutput, setVercelLoginOutput] = useState<string[]>([]);
  const [isVercelLoggingIn, setIsVercelLoggingIn] = useState(false);
  const [isInstallingVercel, setIsInstallingVercel] = useState(false);

  // Claude install state
  const [isInstallingClaude, setIsInstallingClaude] = useState(false);
  const ptyIdRef = useRef<number | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-scroll vercel login output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [vercelLoginOutput]);

  // Cleanup PTY on unmount
  useEffect(() => {
    return () => {
      if (ptyIdRef.current !== null) {
        invoke("kill_pty", { id: ptyIdRef.current }).catch(() => {});
      }
    };
  }, []);

  const loadProjects = async () => {
    try {
      const projectList = await invoke<Project[]>("list_projects");

      // Load thumbnails for each project
      const projectsWithThumbnails = await Promise.all(
        projectList.map(async (project) => {
          let thumbnailData: string | null = null;
          if (project.thumbnail) {
            try {
              thumbnailData = await invoke<string | null>("get_project_thumbnail", {
                projectPath: project.path,
              });
            } catch (e) {
              console.error("Failed to load thumbnail for", project.name, e);
            }
          }
          return { ...project, thumbnailData };
        })
      );

      setProjects(projectsWithThumbnails);
    } catch (error) {
      console.error("Failed to load projects:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleDelete = async (project: Project) => {
    setDeleting(true);
    try {
      await invoke("delete_project", { path: project.path });
      setDeleteConfirm(null);
      await loadProjects();
    } catch (error) {
      console.error("Failed to delete project:", error);
      alert("Failed to delete project: " + error);
    } finally {
      setDeleting(false);
    }
  };

  const handleInstallClaude = async () => {
    setIsInstallingClaude(true);
    try {
      await installClaudeCli();
      onClaudeConnect();
    } catch (e) {
      console.error("Failed to install Claude Code:", e);
    } finally {
      setIsInstallingClaude(false);
    }
  };

  const handleInstallVercel = async () => {
    setIsInstallingVercel(true);
    try {
      await installVercelCli();
      onVercelConnect();
    } catch (e) {
      console.error("Failed to install Vercel CLI:", e);
    } finally {
      setIsInstallingVercel(false);
    }
  };

  const handleVercelLogin = async () => {
    setShowVercelLogin(true);
    setVercelLoginOutput([]);
    setIsVercelLoggingIn(true);

    try {
      const homeDir = await invoke<string>("get_marketingstack_dir");
      const parentDir = homeDir.replace("/Marketingstack", "");

      const ptyId = await invoke<number>("spawn_pty", {
        cwd: parentDir,
        command: "vercel",
        args: ["login"],
        rows: 24,
        cols: 80,
      });
      ptyIdRef.current = ptyId;

      const unlistenOutput = await listen<{ id: number; data: string }>(
        "pty-output",
        (event) => {
          if (event.payload.id === ptyId) {
            setVercelLoginOutput((prev) => [...prev, event.payload.data]);
          }
        }
      );

      const unlistenExit = await listen<{ id: number; code: number | null }>(
        "pty-exit",
        async (event) => {
          if (event.payload.id === ptyId) {
            ptyIdRef.current = null;
            setIsVercelLoggingIn(false);
            unlistenOutput();
            unlistenExit();

            const status = await checkVercelCliStatus();
            if (status.authenticated) {
              setShowVercelLogin(false);
              onVercelConnect();
            }
          }
        }
      );
    } catch (e) {
      console.error("Failed to start Vercel login:", e);
      setIsVercelLoggingIn(false);
    }
  };

  const handleCloseVercelLogin = async () => {
    if (ptyIdRef.current !== null) {
      await invoke("kill_pty", { id: ptyIdRef.current }).catch(() => {});
      ptyIdRef.current = null;
    }
    setShowVercelLogin(false);
    setIsVercelLoggingIn(false);
    onVercelConnect();
  };

  if (loading) {
    return (
      <div className="project-list-loading">
        <div className="spinner" />
        <p>Loading projects...</p>
      </div>
    );
  }

  return (
    <div className="project-list">
      <div className="project-list-header">
        <h1>Marketingstack</h1>
        <p>Build AI native marketing sites easily with SOTA technology.</p>
      </div>

      {/* Connections Dashboard */}
      <div className="connections-dashboard">
        {/* Claude Connection */}
        <div className={`connection-card ${claudeState.cliStatus.installed ? 'connected' : 'disconnected'}`}>
          <div className="connection-icon">
            <ClaudeIcon />
          </div>
          <div className="connection-info">
            <span className="connection-name">Claude</span>
            {claudeState.cliStatus.installed ? (
              <span className="connection-status">
                {claudeState.cliStatus.version || 'Connected'}
              </span>
            ) : (
              <span className="connection-status disconnected">Not installed</span>
            )}
          </div>
          {!claudeState.cliStatus.installed && (
            <button
              className="connection-action"
              onClick={handleInstallClaude}
              disabled={isInstallingClaude}
            >
              {isInstallingClaude ? 'Installing...' : 'Install'}
            </button>
          )}
        </div>

        {/* GitHub Connection */}
        <div className={`connection-card ${githubState.cliStatus.authenticated ? 'connected' : 'disconnected'}`}>
          <div className="connection-icon">
            <GitHubIcon />
          </div>
          <div className="connection-info">
            <span className="connection-name">GitHub</span>
            {!githubState.cliStatus.installed ? (
              <span className="connection-status disconnected">CLI not installed</span>
            ) : !githubState.cliStatus.authenticated ? (
              <span className="connection-status disconnected">Not connected</span>
            ) : (
              <span className="connection-status">{githubState.username}</span>
            )}
          </div>
          {!githubState.cliStatus.installed ? (
            <button
              className="connection-action"
              onClick={() => openUrl("https://cli.github.com/")}
            >
              Install
            </button>
          ) : !githubState.cliStatus.authenticated ? (
            <button
              className="connection-action"
              onClick={() => {
                openUrl("https://github.com/login/device");
                const pollAuth = async () => {
                  for (let i = 0; i < 60; i++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    onGitHubConnect();
                  }
                };
                pollAuth();
              }}
            >
              Connect
            </button>
          ) : null}
        </div>

        {/* Vercel Connection */}
        <div className={`connection-card ${vercelState.cliStatus.authenticated ? 'connected' : 'disconnected'}`}>
          <div className="connection-icon">
            <VercelIcon />
          </div>
          <div className="connection-info">
            <span className="connection-name">Vercel</span>
            {!vercelState.cliStatus.installed ? (
              <span className="connection-status disconnected">CLI not installed</span>
            ) : !vercelState.cliStatus.authenticated ? (
              <span className="connection-status disconnected">Not connected</span>
            ) : (
              <span className="connection-status">{vercelState.username || 'Connected'}</span>
            )}
          </div>
          {!vercelState.cliStatus.installed ? (
            <button
              className="connection-action"
              onClick={handleInstallVercel}
              disabled={isInstallingVercel}
            >
              {isInstallingVercel ? 'Installing...' : 'Install'}
            </button>
          ) : !vercelState.cliStatus.authenticated ? (
            <button
              className="connection-action"
              onClick={handleVercelLogin}
            >
              Connect
            </button>
          ) : null}
        </div>
      </div>

      <div className="project-list-actions">
        <button className="btn-primary" onClick={onCreateProject}>
          + New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="project-list-empty">
          <p>No projects yet</p>
          <p className="hint">Create your first project to get started</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((project) => (
            <div key={project.path} className="project-card">
              <button
                className="project-card-thumbnail"
                onClick={() => onSelectProject(project)}
              >
                {project.thumbnailData ? (
                  <img
                    src={project.thumbnailData}
                    alt={project.name}
                  />
                ) : (
                  <div className="project-card-placeholder">
                    <span>No preview</span>
                  </div>
                )}
              </button>
              <div className="project-card-info">
                <div className="project-card-details">
                  <span className="project-card-name">{project.name}</span>
                  <span className="project-card-path">{project.path}</span>
                </div>
                <button
                  className="project-card-menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirm(project);
                  }}
                  title="Delete project"
                >
                  •••
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Project?</h3>
            <p>
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?
            </p>
            <p className="hint">This will permanently delete all files in this project.</p>
            <div className="modal-actions">
              <button onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vercel Login Modal */}
      {showVercelLogin && (
        <div className="modal-overlay" onClick={handleCloseVercelLogin}>
          <div className="modal vercel-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Connect to Vercel</h3>
            <p>Follow the prompts below to log in to your Vercel account.</p>

            <div className="vercel-login-output" ref={outputRef}>
              {vercelLoginOutput.map((line, i) => (
                <span key={i}>{line}</span>
              ))}
              {isVercelLoggingIn && <span className="cursor">▋</span>}
            </div>

            <div className="modal-actions">
              <button onClick={handleCloseVercelLogin}>
                {isVercelLoggingIn ? "Cancel" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClaudeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function VercelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 116 100" fill="currentColor">
      <path d="M57.5 0L115 100H0L57.5 0Z" />
    </svg>
  );
}
