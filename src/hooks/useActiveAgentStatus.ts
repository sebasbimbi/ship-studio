/**
 * Reactive read of a project's active terminal tab status from the session
 * registry. Re-renders when the registry changes (via its `useSyncExternalStore`
 * adapter) so callers can surface live agent activity (e.g. an "Agent is
 * working…" indicator) without threading status through props.
 *
 * @module hooks/useActiveAgentStatus
 */

import { useSyncExternalStore } from 'react';
import { sessionRegistry, type TabStatus } from '../lib/sessionRegistry';

/** Status of the `activeTabId` tab in `projectPath`'s session, or undefined. */
export function useActiveAgentStatus(
  projectPath: string | null | undefined,
  activeTabId: number
): TabStatus | undefined {
  useSyncExternalStore(sessionRegistry.subscribeSimple, () => sessionRegistry.getVersion());
  if (!projectPath) return undefined;
  const snap = sessionRegistry.snapshot(projectPath);
  return snap?.terminalTabs.find((t) => t.id === activeTabId)?.status;
}
