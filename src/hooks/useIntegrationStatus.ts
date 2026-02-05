/**
 * Custom hook for managing integration states (GitHub, Vercel, Claude).
 *
 * Extracted from App.tsx to isolate the complex reducer logic for external service
 * integrations. This was a high-value extraction because:
 * - The reducer pattern with multiple action types was adding significant complexity
 * - Auth terminal state and handlers are logically grouped with integration status
 * - Types (GitHubState, VercelState, ClaudeState) are now exported for use by
 *   child components (GitHubButton, VercelButton)
 *
 * Uses a reducer for atomic updates to prevent race conditions when
 * multiple integration statuses are being updated concurrently.
 *
 * @module hooks/useIntegrationStatus
 */

import { useReducer, useCallback, useState } from 'react';
import {
  checkGitHubCliStatus,
  getGitHubUsername,
  getProjectGitHubStatus,
  GitHubCliStatus,
  ProjectGitHubStatus,
} from '../lib/github';
import {
  checkVercelCliStatus,
  getVercelUsername,
  getProjectVercelStatus,
  VercelCliStatus,
  ProjectVercelStatus,
} from '../lib/vercel';
import { checkClaudeCliStatus, ClaudeCliStatus } from '../lib/claude';

/** Global GitHub CLI and authentication state */
export interface GitHubState {
  /** CLI installation and auth status */
  cliStatus: GitHubCliStatus;
  /** Authenticated username or null */
  username: string | null;
}

/** Global Vercel CLI and authentication state */
export interface VercelState {
  /** CLI installation and auth status */
  cliStatus: VercelCliStatus;
  /** Authenticated username or null */
  username: string | null;
}

/** Global Claude CLI state */
export interface ClaudeState {
  /** CLI installation status and version */
  cliStatus: ClaudeCliStatus;
}

/** Auth terminal configuration for login flows */
export interface AuthTerminalConfig {
  service: 'github' | 'vercel';
  command: string;
  args: string[];
}

/**
 * Consolidated integration state for all external services.
 * Managed via useReducer for atomic updates to prevent race conditions.
 */
export interface IntegrationState {
  /** GitHub CLI and auth state */
  github: GitHubState;
  /** Current project's GitHub repo status */
  projectGithub: ProjectGitHubStatus | null;
  /** Vercel CLI and auth state */
  vercel: VercelState;
  /** Current project's Vercel deployment status */
  projectVercel: ProjectVercelStatus | null;
  /** Claude CLI state */
  claude: ClaudeState;
}

type IntegrationAction =
  | { type: 'SET_GITHUB'; payload: GitHubState }
  | { type: 'SET_PROJECT_GITHUB'; payload: ProjectGitHubStatus | null }
  | { type: 'SET_VERCEL'; payload: VercelState }
  | { type: 'SET_PROJECT_VERCEL'; payload: ProjectVercelStatus | null }
  | { type: 'SET_CLAUDE'; payload: ClaudeState }
  | { type: 'CLEAR_PROJECT_STATUSES' }
  | {
      type: 'SET_ALL_CLI';
      payload: { github: GitHubState; vercel: VercelState; claude: ClaudeState };
    }
  | {
      type: 'SET_PROJECT_STATUSES';
      payload: { github: ProjectGitHubStatus | null; vercel: ProjectVercelStatus | null };
    };

const initialIntegrationState: IntegrationState = {
  github: { cliStatus: { installed: false, authenticated: false }, username: null },
  projectGithub: null,
  vercel: { cliStatus: { installed: false, authenticated: false }, username: null },
  projectVercel: null,
  claude: { cliStatus: { installed: false, version: null } },
};

function integrationReducer(state: IntegrationState, action: IntegrationAction): IntegrationState {
  switch (action.type) {
    case 'SET_GITHUB':
      return { ...state, github: action.payload };
    case 'SET_PROJECT_GITHUB':
      return { ...state, projectGithub: action.payload };
    case 'SET_VERCEL':
      return { ...state, vercel: action.payload };
    case 'SET_PROJECT_VERCEL':
      return { ...state, projectVercel: action.payload };
    case 'SET_CLAUDE':
      return { ...state, claude: action.payload };
    case 'CLEAR_PROJECT_STATUSES':
      return { ...state, projectGithub: null, projectVercel: null };
    case 'SET_ALL_CLI':
      return {
        ...state,
        github: action.payload.github,
        vercel: action.payload.vercel,
        claude: action.payload.claude,
      };
    case 'SET_PROJECT_STATUSES':
      return {
        ...state,
        projectGithub: action.payload.github,
        projectVercel: action.payload.vercel,
      };
    default:
      return state;
  }
}

/** Return type for useIntegrationStatus hook */
export interface UseIntegrationStatusReturn {
  /** Current integration states */
  integrations: IntegrationState;
  /** Whether the initial CLI status check has completed */
  isInitialCheckDone: boolean;
  /** Dispatch function for direct reducer actions */
  dispatch: React.Dispatch<IntegrationAction>;
  /** Refresh GitHub CLI status */
  refreshGitHubStatus: () => Promise<void>;
  /** Refresh Vercel CLI status */
  refreshVercelStatus: () => Promise<void>;
  /** Refresh Claude CLI status */
  refreshClaudeStatus: () => Promise<void>;
  /** Refresh all CLI statuses at once */
  refreshAllCliStatuses: () => Promise<void>;
  /** Set project GitHub status */
  setProjectGitHubStatus: (status: ProjectGitHubStatus | null) => void;
  /** Set project Vercel status */
  setProjectVercelStatus: (status: ProjectVercelStatus | null) => void;
  /** Clear both project statuses */
  clearProjectStatuses: () => void;
  /** Auth terminal configuration (null when not showing) */
  authTerminalConfig: AuthTerminalConfig | null;
  /** Open GitHub auth terminal */
  handleGitHubConnect: () => void;
  /** Open Vercel auth terminal */
  handleVercelConnect: () => void;
  /** Handle auth terminal exit and refresh status */
  handleAuthTerminalExit: (exitCode: number | null, projectPath?: string) => Promise<void>;
  /** Close auth terminal without refreshing */
  closeAuthTerminal: () => void;
  /** Fetch project GitHub status */
  fetchProjectGitHubStatus: (projectPath: string) => Promise<ProjectGitHubStatus>;
  /** Fetch project Vercel status */
  fetchProjectVercelStatus: (projectPath: string) => Promise<ProjectVercelStatus>;
}

/** Fallback GitHub status when check fails */
export const GITHUB_STATUS_FALLBACK: ProjectGitHubStatus = {
  status: 'no-remote',
  github_repo: null,
  github_url: null,
};

/** Fallback Vercel status when check fails */
export const VERCEL_STATUS_FALLBACK: ProjectVercelStatus = {
  status: 'not-linked',
  project_name: null,
  vercel_org: null,
  production_url: null,
  staging_url: null,
};

/**
 * Hook for managing integration states (GitHub, Vercel, Claude).
 *
 * @example
 * ```tsx
 * const {
 *   integrations,
 *   refreshGitHubStatus,
 *   handleGitHubConnect,
 *   authTerminalConfig,
 * } = useIntegrationStatus();
 *
 * // Check if GitHub is authenticated
 * if (integrations.github.cliStatus.authenticated) {
 *   // User is logged in
 * }
 *
 * // Refresh status after an action
 * await refreshGitHubStatus();
 *
 * // Open auth terminal
 * handleGitHubConnect();
 * ```
 *
 * @returns Integration state and control functions
 */
export function useIntegrationStatus(): UseIntegrationStatusReturn {
  const [integrations, dispatch] = useReducer(integrationReducer, initialIntegrationState);
  const [authTerminalConfig, setAuthTerminalConfig] = useState<AuthTerminalConfig | null>(null);
  const [isInitialCheckDone, setIsInitialCheckDone] = useState(false);

  // Generic refresh helper for authenticated integrations
  const refreshAuthenticatedIntegration = async (
    checkStatus: () => Promise<GitHubCliStatus> | Promise<VercelCliStatus>,
    getUsername: () => Promise<string>,
    actionType: 'SET_GITHUB' | 'SET_VERCEL'
  ) => {
    const status = await checkStatus();
    let username: string | null = null;
    if (status.authenticated) {
      try {
        username = await getUsername();
      } catch {
        // Ignore - username is optional
      }
    }
    dispatch({ type: actionType, payload: { cliStatus: status, username } });
  };

  const refreshGitHubStatus = useCallback(
    () => refreshAuthenticatedIntegration(checkGitHubCliStatus, getGitHubUsername, 'SET_GITHUB'),
    []
  );

  const refreshVercelStatus = useCallback(
    () => refreshAuthenticatedIntegration(checkVercelCliStatus, getVercelUsername, 'SET_VERCEL'),
    []
  );

  const refreshClaudeStatus = useCallback(async () => {
    const status = await checkClaudeCliStatus();
    dispatch({ type: 'SET_CLAUDE', payload: { cliStatus: status } });
  }, []);

  const refreshAllCliStatuses = useCallback(async () => {
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

    let vcUsername: string | null = null;
    if (vcStatus.authenticated) {
      try {
        vcUsername = await getVercelUsername();
      } catch {
        // Ignore - username is optional
      }
    }

    dispatch({
      type: 'SET_ALL_CLI',
      payload: {
        github: { cliStatus: ghStatus, username: ghUsername },
        vercel: { cliStatus: vcStatus, username: vcUsername },
        claude: { cliStatus: clStatus },
      },
    });
    setIsInitialCheckDone(true);
  }, []);

  const setProjectGitHubStatus = useCallback((status: ProjectGitHubStatus | null) => {
    dispatch({ type: 'SET_PROJECT_GITHUB', payload: status });
  }, []);

  const setProjectVercelStatus = useCallback((status: ProjectVercelStatus | null) => {
    dispatch({ type: 'SET_PROJECT_VERCEL', payload: status });
  }, []);

  const clearProjectStatuses = useCallback(() => {
    dispatch({ type: 'CLEAR_PROJECT_STATUSES' });
  }, []);

  const handleGitHubConnect = useCallback(() => {
    setAuthTerminalConfig({
      service: 'github',
      command: 'gh',
      args: ['auth', 'login', '--web', '--git-protocol', 'https'],
    });
  }, []);

  const handleVercelConnect = useCallback(() => {
    setAuthTerminalConfig({
      service: 'vercel',
      command: 'vercel',
      args: ['login'],
    });
  }, []);

  const handleAuthTerminalExit = useCallback(
    async (exitCode: number | null, projectPath?: string) => {
      const service = authTerminalConfig?.service;
      setAuthTerminalConfig(null);

      if (exitCode === 0 || exitCode === null) {
        // Success - refresh the appropriate status
        if (service === 'github') {
          await refreshGitHubStatus();
          // Also refresh project GitHub status if we have a project path
          if (projectPath) {
            const projectStatus = await getProjectGitHubStatus(projectPath);
            dispatch({ type: 'SET_PROJECT_GITHUB', payload: projectStatus });
          }
        } else if (service === 'vercel') {
          await refreshVercelStatus();
          if (projectPath) {
            const projectStatus = await getProjectVercelStatus(projectPath);
            dispatch({ type: 'SET_PROJECT_VERCEL', payload: projectStatus });
          }
        }
      }
    },
    [authTerminalConfig, refreshGitHubStatus, refreshVercelStatus]
  );

  const closeAuthTerminal = useCallback(() => {
    setAuthTerminalConfig(null);
  }, []);

  const fetchProjectGitHubStatus = useCallback(async (projectPath: string) => {
    const status = await getProjectGitHubStatus(projectPath).catch(() => GITHUB_STATUS_FALLBACK);
    dispatch({ type: 'SET_PROJECT_GITHUB', payload: status });
    return status;
  }, []);

  const fetchProjectVercelStatus = useCallback(async (projectPath: string) => {
    const status = await getProjectVercelStatus(projectPath).catch(() => VERCEL_STATUS_FALLBACK);
    dispatch({ type: 'SET_PROJECT_VERCEL', payload: status });
    return status;
  }, []);

  return {
    integrations,
    isInitialCheckDone,
    dispatch,
    refreshGitHubStatus,
    refreshVercelStatus,
    refreshClaudeStatus,
    refreshAllCliStatuses,
    setProjectGitHubStatus,
    setProjectVercelStatus,
    clearProjectStatuses,
    authTerminalConfig,
    handleGitHubConnect,
    handleVercelConnect,
    handleAuthTerminalExit,
    closeAuthTerminal,
    fetchProjectGitHubStatus,
    fetchProjectVercelStatus,
  };
}
