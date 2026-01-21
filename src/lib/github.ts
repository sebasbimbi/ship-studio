import { invoke } from "@tauri-apps/api/core";

export interface GitHubCliStatus {
  installed: boolean;
  authenticated: boolean;
}

export interface ProjectGitHubStatus {
  /** "not-a-repo" | "no-remote" | "connected" */
  status: "not-a-repo" | "no-remote" | "connected";
  /** e.g., "username/repo-name" - only set if connected */
  github_repo: string | null;
  /** e.g., "https://github.com/username/repo-name" - only set if connected */
  github_url: string | null;
}

export async function checkGitHubCliStatus(): Promise<GitHubCliStatus> {
  return invoke<GitHubCliStatus>("check_github_cli_status");
}

export async function getGitHubUsername(): Promise<string> {
  return invoke<string>("get_github_username");
}

export async function getGitHubOrgs(): Promise<string[]> {
  return invoke<string[]>("get_github_orgs");
}

export async function getProjectGitHubStatus(projectPath: string): Promise<ProjectGitHubStatus> {
  return invoke<ProjectGitHubStatus>("get_project_github_status", { projectPath });
}

export interface PushToGitHubOptions {
  projectPath: string;
  repoName: string;
  isPrivate: boolean;
}

export async function pushToGitHub(options: PushToGitHubOptions): Promise<string> {
  return invoke<string>("push_to_github", { options });
}

interface PublishResult {
  url: string;
  state: string;
}

export async function publishToStaging(projectPath: string): Promise<PublishResult> {
  return invoke<PublishResult>("publish_to_staging", { projectPath });
}

export async function publishToProduction(projectPath: string): Promise<PublishResult> {
  return invoke<PublishResult>("publish_to_production", { projectPath });
}

export interface BranchStatus {
  local_changes: boolean;
  staging_ahead: number;
  staging_behind: number;
  main_ahead: number;
  main_behind: number;
  staging_exists: boolean;
}

export async function getBranchStatus(projectPath: string): Promise<BranchStatus> {
  return invoke<BranchStatus>("get_branch_status", { projectPath });
}

export async function resetToBranch(projectPath: string, branch: "staging" | "production"): Promise<void> {
  return invoke("reset_to_branch", { projectPath, branch });
}
