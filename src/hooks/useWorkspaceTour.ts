/**
 * Open/close state for the first-run workspace tour.
 *
 * `isOpen` is lazy-initialized from the seen flag (auto-runs once), but the flag
 * is only PERSISTED by the tour component when it actually renders — so a
 * compact-mode launch (where the tour doesn't render) isn't silently consumed.
 * `start` replays it on demand.
 *
 * @module hooks/useWorkspaceTour
 */

import { useCallback, useState } from 'react';
import { hasSeenWorkspaceTour, markWorkspaceTourSeen } from '../lib/workspaceTour';

export interface WorkspaceTour {
  isOpen: boolean;
  /** Open the tour (replay) — ignores the seen flag. */
  start: () => void;
  /** Close + mark seen (skip / finish / dismiss). */
  close: () => void;
}

export function useWorkspaceTour(): WorkspaceTour {
  const [isOpen, setIsOpen] = useState(() => !hasSeenWorkspaceTour());
  const start = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    markWorkspaceTourSeen();
    setIsOpen(false);
  }, []);
  return { isOpen, start, close };
}
