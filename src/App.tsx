import { useState, useEffect, useRef } from "react";
import { Terminal } from "./components/Terminal";
import { Preview } from "./components/Preview";
import { ProjectList } from "./components/ProjectList";
import { CreateProject } from "./components/CreateProject";
import { SetupScreen } from "./components/SetupScreen";
import { SplitPane } from "./components/SplitPane";
import { GitHubButton } from "./components/GitHubButton";
import { VercelButton } from "./components/VercelButton";
import { checkPrerequisites, startDevServer, Prerequisite, Project, DevServerHandle } from "./lib/project";
import {
  checkGitHubCliStatus,
  getGitHubUsername,
  getProjectGitHubStatus,
  GitHubCliStatus,
  ProjectGitHubStatus,
} from "./lib/github";
import {
  checkVercelCliStatus,
  getVercelUsername,
  getProjectVercelStatus,
  VercelCliStatus,
  ProjectVercelStatus,
} from "./lib/vercel";
import { checkClaudeCliStatus, ClaudeCliStatus } from "./lib/claude";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type AppView = "loading" | "setup" | "projects" | "create" | "workspace";

export interface GitHubState {
  cliStatus: GitHubCliStatus;
  username: string | null;
}

export interface VercelState {
  cliStatus: VercelCliStatus;
  username: string | null;
}

export interface ClaudeState {
  cliStatus: ClaudeCliStatus;
}

function App() {
  const [view, setView] = useState<AppView>("loading");
  const [prerequisites, setPrerequisites] = useState<Prerequisite[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const devServerRef = useRef<DevServerHandle | null>(null);

  // GitHub state
  const [githubState, setGithubState] = useState<GitHubState>({
    cliStatus: { installed: false, authenticated: false },
    username: null,
  });
  const [projectGithubStatus, setProjectGithubStatus] = useState<ProjectGitHubStatus | null>(null);

  // Vercel state
  const [vercelState, setVercelState] = useState<VercelState>({
    cliStatus: { installed: false, authenticated: false },
    username: null,
  });
  const [projectVercelStatus, setProjectVercelStatus] = useState<ProjectVercelStatus | null>(null);

  // Claude state
  const [claudeState, setClaudeState] = useState<ClaudeState>({
    cliStatus: { installed: false, version: null },
  });

  // Check prerequisites and GitHub status on mount
  useEffect(() => {
    checkSetup();
  }, []);

  const checkSetup = async () => {
    setView("loading");
    try {
      const prereqs = await checkPrerequisites();
      setPrerequisites(prereqs);

      // Check GitHub, Vercel, and Claude status in parallel
      const [ghStatus, vcStatus, clStatus] = await Promise.all([
        checkGitHubCliStatus(),
        checkVercelCliStatus(),
        checkClaudeCliStatus(),
      ]);

      let ghUsername: string | null = null;
      if (ghStatus.authenticated) {
        try {
          ghUsername = await getGitHubUsername();
        } catch {
          // Ignore - username is optional
        }
      }
      setGithubState({ cliStatus: ghStatus, username: ghUsername });

      let vcUsername: string | null = null;
      if (vcStatus.authenticated) {
        try {
          vcUsername = await getVercelUsername();
        } catch {
          // Ignore - username is optional
        }
      }
      setVercelState({ cliStatus: vcStatus, username: vcUsername });

      // Set Claude state
      setClaudeState({ cliStatus: clStatus });

      const allAvailable = prereqs.every((p) => p.available);
      if (allAvailable) {
        setView("projects");
      } else {
        setView("setup");
      }
    } catch (error) {
      console.error("Failed to check prerequisites:", error);
      setView("setup");
    }
  };

  const refreshGitHubStatus = async () => {
    const ghStatus = await checkGitHubCliStatus();
    let username: string | null = null;
    if (ghStatus.authenticated) {
      try {
        username = await getGitHubUsername();
      } catch {
        // Ignore
      }
    }
    setGithubState({ cliStatus: ghStatus, username });
  };

  const refreshVercelStatus = async () => {
    const vcStatus = await checkVercelCliStatus();
    let username: string | null = null;
    if (vcStatus.authenticated) {
      try {
        username = await getVercelUsername();
      } catch {
        // Ignore
      }
    }
    setVercelState({ cliStatus: vcStatus, username });
  };

  const refreshClaudeStatus = async () => {
    const clStatus = await checkClaudeCliStatus();
    setClaudeState({ cliStatus: clStatus });
  };

  const handleSelectProject = async (project: Project) => {
    setCurrentProject(project);

    // Check project's GitHub and Vercel status in parallel
    try {
      const [ghStatus, vcStatus] = await Promise.all([
        getProjectGitHubStatus(project.path).catch(() => null),
        getProjectVercelStatus(project.path).catch(() => null),
      ]);
      setProjectGithubStatus(ghStatus);
      setProjectVercelStatus(vcStatus);
    } catch {
      setProjectGithubStatus(null);
      setProjectVercelStatus(null);
    }

    // Start dev server in background
    try {
      devServerRef.current = await startDevServer(project.path);
    } catch (error) {
      console.error("Failed to start dev server:", error);
    }

    setView("workspace");
  };

  const handleCreateProject = () => {
    setView("create");
  };

  const handleProjectCreated = async (projectPath: string) => {
    const projectName = projectPath.split("/").pop() || "project";
    handleSelectProject({ name: projectName, path: projectPath, thumbnail: null });
  };

  const handleBackToProjects = async () => {
    setIsClosing(true);

    // Capture thumbnail before closing
    if (currentProject) {
      try {
        await invoke("capture_project_thumbnail", {
          projectPath: currentProject.path,
          url: "http://localhost:3000",
        });
      } catch (error) {
        console.error("Failed to capture thumbnail:", error);
      }
    }

    // Stop dev server if running
    if (devServerRef.current) {
      await devServerRef.current.stop();
      devServerRef.current = null;
    }
    setCurrentProject(null);
    setProjectGithubStatus(null);
    setProjectVercelStatus(null);
    setIsClosing(false);
    setView("projects");
  };

  const handleGitHubStatusChange = async () => {
    // Refresh project GitHub and Vercel status after push/publish
    if (currentProject) {
      const [ghStatus, vcStatus] = await Promise.all([
        getProjectGitHubStatus(currentProject.path).catch(() => null),
        getProjectVercelStatus(currentProject.path).catch(() => null),
      ]);
      setProjectGithubStatus(ghStatus);
      setProjectVercelStatus(vcStatus);
    }
  };

  const handleVercelStatusChange = async () => {
    // Refresh project Vercel status after linking
    if (currentProject) {
      const status = await getProjectVercelStatus(currentProject.path).catch(() => null);
      setProjectVercelStatus(status);
    }
  };

  if (view === "loading") {
    return (
      <div className="app loading">
        <div className="spinner" />
        <p>Loading Marketingstack...</p>
      </div>
    );
  }

  if (view === "setup") {
    return (
      <div className="app">
        <SetupScreen prerequisites={prerequisites} onRetry={checkSetup} />
      </div>
    );
  }

  if (view === "projects") {
    return (
      <div className="app">
        <ProjectList
          onSelectProject={handleSelectProject}
          onCreateProject={handleCreateProject}
          githubState={githubState}
          vercelState={vercelState}
          claudeState={claudeState}
          onGitHubConnect={refreshGitHubStatus}
          onVercelConnect={refreshVercelStatus}
          onClaudeConnect={refreshClaudeStatus}
        />
      </div>
    );
  }

  if (view === "create") {
    return (
      <div className="app">
        <CreateProject
          onComplete={handleProjectCreated}
          onCancel={() => setView("projects")}
        />
      </div>
    );
  }

  // Workspace view
  return (
    <div className="app workspace">
      <header className="workspace-header">
        <button
          className="back-button"
          onClick={handleBackToProjects}
          disabled={isClosing}
        >
          {isClosing ? "Saving..." : "← Projects"}
        </button>
        <h1>{currentProject?.name}</h1>
        <span className="project-path">{currentProject?.path}</span>

        <div className="workspace-header-actions">
          <GitHubButton
            githubState={githubState}
            vercelState={vercelState}
            projectStatus={projectGithubStatus}
            projectPath={currentProject?.path || ""}
            projectName={currentProject?.name || ""}
            onStatusChange={handleGitHubStatusChange}
            onGitHubConnect={refreshGitHubStatus}
          />
          <VercelButton
            vercelState={vercelState}
            projectVercelStatus={projectVercelStatus}
            projectGithubStatus={projectGithubStatus}
            projectPath={currentProject?.path || ""}
            projectName={currentProject?.name || ""}
            onStatusChange={handleVercelStatusChange}
            onVercelConnect={refreshVercelStatus}
          />
        </div>
      </header>

      <div className="workspace-content">
        <SplitPane
          defaultSplit={28}
          minLeft={20}
          minRight={35}
          left={
            <div className="terminal-pane">
              <Terminal
                projectPath={currentProject?.path || ""}
                onExit={(code) => {
                  console.log("Terminal exited with code:", code);
                }}
              />
            </div>
          }
          right={
            <div className="preview-pane">
              <Preview port={3000} projectPath={currentProject?.path || ""} />
            </div>
          }
        />
      </div>
    </div>
  );
}

export default App;
