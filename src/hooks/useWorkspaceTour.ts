/**
 * Open/close state for the first-run workspace tour, backed by the shared modal
 * stack ({@link useModal}) so the tour participates in the same open/close +
 * analytics machinery as every other modal.
 *
 * It auto-runs once: on first mount, if the seen flag isn't set, it opens. The
 * flag is only PERSISTED by the tour component when it actually renders — so a
 * compact-mode launch (where the tour doesn't render) isn't silently consumed.
 * `start` replays it on demand.
 *
 * @module hooks/useWorkspaceTour
 */

import { useCallback, useEffect, useRef } from 'react';
import { hasSeenWorkspaceTour, markWorkspaceTourSeen } from '../lib/workspaceTour';
import { useModal } from '../contexts/ModalContext';

export interface WorkspaceTour {
  isOpen: boolean;
  /** Open the tour (replay) — ignores the seen flag. */
  start: () => void;
  /** Close + mark seen (skip / finish / dismiss). */
  close: () => void;
}

export function useWorkspaceTour(): WorkspaceTour {
  const modal = useModal('workspaceTour');
  const { open, close: closeModal } = modal;

  // Auto-run once on first mount when unseen. The seen flag is persisted by the
  // tour component on render, so a compact-mode launch re-arms it next time.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (!hasSeenWorkspaceTour()) open();
  }, [open]);

  const start = useCallback(() => open(), [open]);
  const close = useCallback(() => {
    markWorkspaceTourSeen();
    closeModal();
  }, [closeModal]);

  return { isOpen: modal.isOpen, start, close };
}
