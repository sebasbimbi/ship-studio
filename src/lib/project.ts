import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface Project {
  name: string;
  path: string;
}

export interface Prerequisite {
  name: string;
  available: boolean;
  path: string | null;
}

export async function checkPrerequisites(): Promise<Prerequisite[]> {
  return invoke<Prerequisite[]>("check_prerequisites");
}

export async function listProjects(): Promise<Project[]> {
  return invoke<Project[]>("list_projects");
}

export async function getMarosDir(): Promise<string> {
  return invoke<string>("get_maros_dir");
}

export async function ensureMarosDir(): Promise<string> {
  return invoke<string>("ensure_maros_dir");
}

export interface DevServerHandle {
  ptyId: number;
  stop: () => Promise<void>;
}

export async function startDevServer(
  projectPath: string,
  onOutput?: (data: string) => void
): Promise<DevServerHandle> {
  let unlistenOutput: UnlistenFn | null = null;

  if (onOutput) {
    unlistenOutput = await listen<{ id: number; data: string }>(
      "pty-output",
      (event) => {
        onOutput(event.payload.data);
      }
    );
  }

  const ptyId = await invoke<number>("spawn_pty", {
    cwd: projectPath,
    command: "npm",
    args: ["run", "dev"],
    rows: 24,
    cols: 80,
  });

  return {
    ptyId,
    stop: async () => {
      unlistenOutput?.();
      try {
        await invoke("kill_pty", { id: ptyId });
      } catch {
        // Ignore errors
      }
    },
  };
}

export async function waitForServer(
  url: string,
  maxAttempts = 30,
  intervalMs = 1000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fetch(url, { mode: "no-cors" });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return false;
}
