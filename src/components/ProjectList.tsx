import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitHubState, VercelState, ClaudeState } from "../App";
import { installVercelCli, checkVercelCliStatus } from "../lib/vercel";
import { installClaudeCli } from "../lib/claude";
import { DashboardProject, getDashboardProjects } from "../lib/project";
import { DashboardHeader } from "./DashboardHeader";
import { ProjectCard } from "./ProjectCard";
import { IntegrationBar } from "./IntegrationBar";
import { ChevronIcon, CheckIcon } from "./icons";
import { useClickOutside } from "../hooks/useClickOutside";

interface Project {
  name: string;
  path: string;
  thumbnail: string | null;
}

interface ProjectWithThumbnail extends DashboardProject {
  thumbnailData: string | null;
}

type SortOption = "last_opened" | "name" | "last_deployed";

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
  const [deleteConfirm, setDeleteConfirm] = useState<DashboardProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Search and sort state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("last_opened");
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Vercel login modal state
  const [showVercelLogin, setShowVercelLogin] = useState(false);
  const [vercelLoginOutput, setVercelLoginOutput] = useState<string[]>([]);
  const [isVercelLoggingIn, setIsVercelLoggingIn] = useState(false);
  const [isInstallingVercel, setIsInstallingVercel] = useState(false);

  // Claude install state
  const [isInstallingClaude, setIsInstallingClaude] = useState(false);
  const ptyIdRef = useRef<number | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

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

  // Close sort dropdown when clicking outside
  const closeSortDropdown = useCallback(() => setShowSortDropdown(false), []);
  useClickOutside(sortDropdownRef, closeSortDropdown, showSortDropdown);

  const loadProjects = async () => {
    try {
      const projectList = await getDashboardProjects();

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

  // Filtered and sorted projects
  const filteredProjects = useMemo(() => {
    let result = [...projects];

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.path.toLowerCase().includes(query)
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "last_deployed":
          // Projects without deployment go last
          if (!a.last_deployed && !b.last_deployed) return a.name.localeCompare(b.name);
          if (!a.last_deployed) return 1;
          if (!b.last_deployed) return -1;
          // Parse relative time for sorting (rough approximation)
          return parseRelativeTime(a.last_deployed) - parseRelativeTime(b.last_deployed);
        case "last_opened":
        default:
          if (!a.last_opened && !b.last_opened) return a.name.localeCompare(b.name);
          if (!a.last_opened) return 1;
          if (!b.last_opened) return -1;
          return b.last_opened - a.last_opened;
      }
    });

    return result;
  }, [projects, searchQuery, sortBy]);

  const handleDelete = async (project: DashboardProject) => {
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

  const handleVercelConnect = () => {
    if (!vercelState.cliStatus.installed) {
      handleInstallVercel();
    } else if (!vercelState.cliStatus.authenticated) {
      handleVercelLogin();
    }
  };

  const handleGitHubConnect = () => {
    if (!githubState.cliStatus.installed) {
      openUrl("https://cli.github.com/");
    } else if (!githubState.cliStatus.authenticated) {
      openUrl("https://github.com/login/device");
      // Poll for authentication
      const pollAuth = async () => {
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          onGitHubConnect();
        }
      };
      pollAuth();
    }
  };

  if (loading) {
    return (
      <div className="project-list-loading">
        <div className="spinner" />
        <p>Loading projects...</p>
      </div>
    );
  }

  const sortLabels: Record<SortOption, string> = {
    last_opened: "Last opened",
    name: "Name",
    last_deployed: "Last deployed",
  };

  return (
    <div className="project-list dashboard">
      <DashboardHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onCreateProject={onCreateProject}
      />

      <div className="dashboard-section-header">
        <span className="dashboard-section-title">
          Projects {filteredProjects.length > 0 && `(${filteredProjects.length})`}
        </span>
        <div className="dashboard-section-controls">
          <div className="sort-dropdown" ref={sortDropdownRef}>
            <button
              className="sort-dropdown-btn"
              onClick={() => setShowSortDropdown(!showSortDropdown)}
            >
              {sortLabels[sortBy]}
              <ChevronIcon />
            </button>
            {showSortDropdown && (
              <div className="sort-dropdown-menu">
                {(Object.keys(sortLabels) as SortOption[]).map((option) => (
                  <button
                    key={option}
                    className={`sort-dropdown-item ${sortBy === option ? "active" : ""}`}
                    onClick={() => {
                      setSortBy(option);
                      setShowSortDropdown(false);
                    }}
                  >
                    {sortLabels[option]}
                    {sortBy === option && <CheckIcon />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {filteredProjects.length === 0 ? (
        <div className="project-list-empty">
          {searchQuery ? (
            <>
              <p>No projects found</p>
              <p className="hint">Try a different search term</p>
            </>
          ) : (
            <>
              <p>No projects yet</p>
              <p className="hint">Create your first project to get started</p>
            </>
          )}
        </div>
      ) : (
        <div className="project-grid">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.path}
              project={project}
              thumbnailData={project.thumbnailData}
              onSelect={() => onSelectProject(project)}
              onDelete={() => setDeleteConfirm(project)}
              onOpenSite={
                project.production_url
                  ? () => {
                      const url = project.production_url!;
                      openUrl(url.startsWith("http") ? url : `https://${url}`);
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      <IntegrationBar
        githubState={githubState}
        vercelState={vercelState}
        claudeState={claudeState}
        onGitHubConnect={handleGitHubConnect}
        onVercelConnect={handleVercelConnect}
        onClaudeConnect={handleInstallClaude}
        isInstallingClaude={isInstallingClaude}
        isInstallingVercel={isInstallingVercel}
      />

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
              {isVercelLoggingIn && <span className="cursor">&#9611;</span>}
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

function parseRelativeTime(timeStr: string): number {
  // Parse strings like "2h ago", "3d ago", "5m ago", "just now"
  if (timeStr === "just now") return 0;
  const match = timeStr.match(/^(\d+)([mhd]) ago$/);
  if (!match) return Infinity;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "m": return value;
    case "h": return value * 60;
    case "d": return value * 60 * 24;
    default: return Infinity;
  }
}
