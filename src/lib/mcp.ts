/**
 * MCP Server management utilities.
 *
 * Provides functions for:
 * - Listing MCP servers configured for an agent
 * - Adding new MCP servers via the agent's CLI
 * - Removing MCP servers
 *
 * @module lib/mcp
 */

import { invoke } from '@tauri-apps/api/core';

/** Represents an MCP server configured for an agent. */
export interface McpServer {
  /** Server name (identifier) */
  name: string;
  /** The command string (for stdio) or URL (for http/sse) */
  command_or_url: string;
  /** Server status: "connected", "needs_auth", "error", "unknown" */
  status: string;
  /** Configuration scope: "user", "project", "local" */
  scope: string;
}

/**
 * List all MCP servers configured for the given agent.
 * @param projectPath - Optional project path for project-scoped servers
 * @param agentId - Optional agent ID to list servers for a specific agent
 * @returns Array of configured MCP servers
 */
export async function listMcpServers(projectPath?: string, agentId?: string): Promise<McpServer[]> {
  return invoke<McpServer[]>('list_mcp_servers', { projectPath, agentId });
}

/**
 * Add an MCP server using the agent's CLI.
 * @param rawArgs - Raw arguments for `mcp add` (e.g., "my-server -- npx -y @some/package")
 * @param scope - Configuration scope: "user" or "project"
 * @param projectPath - Optional project path for project-scoped servers
 * @param agentId - Optional agent ID to add for a specific agent
 */
export async function addMcpServer(
  rawArgs: string,
  scope?: string,
  projectPath?: string,
  agentId?: string
): Promise<void> {
  return invoke('add_mcp_server', { rawArgs, scope, projectPath, agentId });
}

/**
 * Remove an MCP server by name.
 * @param name - Server name to remove
 * @param scope - Configuration scope the server was added to
 * @param projectPath - Optional project path for project-scoped servers
 * @param agentId - Optional agent ID to remove for a specific agent
 */
export async function removeMcpServer(
  name: string,
  scope?: string,
  projectPath?: string,
  agentId?: string
): Promise<void> {
  return invoke('remove_mcp_server', { name, scope, projectPath, agentId });
}
