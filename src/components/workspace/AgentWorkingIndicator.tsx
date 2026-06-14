/**
 * Inline "Agent is working…" indicator for the terminal pane header.
 *
 * Surfaces live agent activity right where the user is looking (the terminal),
 * instead of only as a small sidebar dot. Shows a spinner + label while the
 * active tab's agent is `thinking`; renders nothing otherwise.
 *
 * A short trailing delay keeps it visible across the rapid thinking↔(brief
 * pause)↔thinking toggles within a single turn, so it doesn't flicker and the
 * `role="status"` announcement isn't repeated on every micro-transition.
 *
 * Watches the ACTIVE tab only. In side-by-side split view a non-active pane
 * that is thinking shows no indicator — a per-pane indicator in
 * TerminalSplitHeaders is a deliberate follow-up, not built here.
 */

import { useEffect, useState } from 'react';
import { Spinner } from '../primitives/Spinner';
import { useActiveAgentStatus } from '../../hooks/useActiveAgentStatus';

/** How long to keep the indicator up after `thinking` clears, to absorb the
 *  brief gaps between tool calls within one turn. */
const TRAILING_MS = 500;

interface AgentWorkingIndicatorProps {
  /** Project whose active tab to watch (undefined → renders nothing). */
  projectPath: string | undefined;
  /** Id of the active terminal tab. */
  tabId: number;
}

export function AgentWorkingIndicator({ projectPath, tabId }: AgentWorkingIndicatorProps) {
  const working = useActiveAgentStatus(projectPath, tabId) === 'thinking';
  const [visible, setVisible] = useState(working);

  useEffect(() => {
    if (working) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show at once when work starts; only the trailing hide is debounced
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(false), TRAILING_MS);
    return () => clearTimeout(timer);
  }, [working]);

  if (!visible) return null;
  return (
    <div className="terminal-agent-working" role="status">
      <Spinner size="sm" />
      <span>Agent is working…</span>
    </div>
  );
}
