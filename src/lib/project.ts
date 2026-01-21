import { invoke } from "@tauri-apps/api/core";
import { spawn, IPty } from "tauri-pty";

export interface Project {
  name: string;
  path: string;
  thumbnail: string | null;
}

export interface DashboardProject {
  name: string;
  path: string;
  thumbnail: string | null;
  last_opened: number | null;
  /** Current git branch name */
  git_branch: string | null;
  /** Number of uncommitted changes (staged + unstaged) */
  uncommitted_count: number | null;
  /** Production URL from Vercel */
  production_url: string | null;
  /** Relative time string for last deployment (e.g., "2h ago") */
  last_deployed: string | null;
  /** Deployment state: READY, BUILDING, ERROR, QUEUED, CANCELED */
  deployment_state: string | null;
}

export interface Prerequisite {
  name: string;
  available: boolean;
  path: string | null;
}

export async function checkPrerequisites(): Promise<Prerequisite[]> {
  return invoke<Prerequisite[]>("check_prerequisites");
}

export async function getDashboardProjects(): Promise<DashboardProject[]> {
  return invoke<DashboardProject[]>("get_dashboard_projects");
}

export interface DevServerHandle {
  pty: IPty;
  stop: () => Promise<void>;
}

export async function startDevServer(
  projectPath: string,
  onOutput?: (data: string) => void
): Promise<DevServerHandle> {
  const decoder = new TextDecoder();

  const pty = await spawn("npm", ["run", "dev"], {
    cwd: projectPath,
    cols: 80,
    rows: 24,
  });

  if (onOutput) {
    pty.onData((data) => {
      onOutput(decoder.decode(data));
    });
  }

  return {
    pty,
    stop: async () => {
      try {
        pty.kill();
      } catch {
        // Ignore errors
      }
    },
  };
}
