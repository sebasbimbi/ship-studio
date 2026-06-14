/**
 * Guided first-run workspace tour overlay (F23 / PART B).
 *
 * Spotlights the existing `data-education-id` anchors step by step (terminal →
 * preview → device sizes → screenshot → wrap-up) with a positioned card. Steps
 * whose anchor isn't currently in the DOM (code-only project, preview tab not
 * active) are skipped so the copy never narrates UI the user can't see.
 *
 * Reuses the education-anchor convention + `getBoundingClientRect` positioning
 * from EducationOverlay, as a sequenced walkthrough. Auto-runs once (state from
 * `useWorkspaceTour`); also registers a "Take the tour" Cmd+K command so the
 * palette entry lives with the feature.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../primitives/Button';
import { ModalFrame } from '../primitives/ModalFrame';
import { GraduationCapIcon } from '../icons';
import { useCommands } from '../../commands/useCommands';
import {
  WORKSPACE_TOUR_STEPS,
  markWorkspaceTourSeen,
  type TourStep,
} from '../../lib/workspaceTour';
import type { WorkspaceTour as WorkspaceTourState } from '../../hooks/useWorkspaceTour';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 320;
const CARD_HEIGHT_EST = 200; // for the fits-below/above decision
const GAP = 12;

/** Steps present right now: anchorless ones, plus anchored ones whose element exists. */
function presentSteps(): TourStep[] {
  const present = WORKSPACE_TOUR_STEPS.filter(
    (s) => !s.anchor || document.querySelector(`[data-education-id="${s.anchor}"]`)
  );
  // Always keep at least the anchorless finale so the tour can't be empty.
  return present.length ? present : WORKSPACE_TOUR_STEPS.filter((s) => !s.anchor);
}

export function WorkspaceTour({ tour }: { tour: WorkspaceTourState }) {
  const { isOpen, start, close } = tour;
  const [nav, setNav] = useState<{ steps: TourStep[]; index: number }>({ steps: [], index: 0 });
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const { steps, index: stepIndex } = nav;
  const step = steps[stepIndex];

  // Persist "seen" as soon as the tour is actually in play (it only renders when
  // not in compact mode), so it auto-runs exactly once.
  useEffect(() => {
    markWorkspaceTourSeen();
  }, []);

  // Register the replay command (co-located so WorkspaceView stays lean).
  useCommands(
    () => [
      {
        id: 'tour.replay',
        title: 'Take the tour',
        icon: <GraduationCapIcon size={14} />,
        category: 'action' as const,
        when: 'project' as const,
        keywords: ['tour', 'walkthrough', 'guide', 'onboarding', 'help'],
        run: () => start(),
      },
    ],
    [start]
  );

  // Build the effective step list (skipping absent anchors) each time it opens.
  useLayoutEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init of the step list from the anchors actually present when the tour opens
    setNav({ steps: presentSteps(), index: 0 });
  }, [isOpen]);

  // Measure the current step's anchor for the spotlight; re-measure on resize/scroll.
  useLayoutEffect(() => {
    if (!isOpen || !step) return;
    const measure = () => {
      const el = step.anchor
        ? document.querySelector(`[data-education-id="${step.anchor}"]`)
        : null;
      const r = el?.getBoundingClientRect();
      setRect(
        r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null
      );
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [isOpen, stepIndex, step]);

  const isLast = stepIndex >= steps.length - 1;
  const next = useCallback(() => {
    setNav((n) => (n.index >= n.steps.length - 1 ? n : { ...n, index: n.index + 1 }));
    if (isLast) close();
  }, [isLast, close]);
  const back = useCallback(() => setNav((n) => ({ ...n, index: Math.max(0, n.index - 1) })), []);

  // Move focus into the dialog on open + each step so AT announces it; keyboard nav.
  useEffect(() => {
    if (!isOpen || !step) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowRight') {
        next();
      } else if (e.key === 'ArrowLeft') {
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, stepIndex, step, next, back, close]);

  if (!isOpen || !step) return null;

  // An anchored card positions below the anchor if it fits, else above. When the
  // anchor leaves no room either way (e.g. a full-height terminal/preview pane),
  // the card centers on screen — but the spotlight ring still highlights the
  // anchor, so it stays in the anchored render path (not the plain ModalFrame).
  let cardCentered = false;
  let cardStyle: React.CSSProperties = {};
  if (rect) {
    const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - CARD_WIDTH - GAP));
    if (rect.top + rect.height + GAP + CARD_HEIGHT_EST <= window.innerHeight) {
      cardStyle = { top: rect.top + rect.height + GAP, left };
    } else if (rect.top - GAP - CARD_HEIGHT_EST >= 0) {
      cardStyle = { bottom: window.innerHeight - rect.top + GAP, left };
    } else {
      cardCentered = true;
    }
  }

  const cardBody = (
    <>
      <div className="workspace-tour-step">
        Step {stepIndex + 1} of {steps.length}
      </div>
      <h3 className="workspace-tour-title">{step.title}</h3>
      <p className="workspace-tour-body">{step.body}</p>
      <div className="workspace-tour-actions">
        <Button variant="ghost" size="sm" onClick={close}>
          Skip
        </Button>
        <div className="workspace-tour-nav">
          {stepIndex > 0 && (
            <Button variant="secondary" size="sm" onClick={back}>
              Back
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={next}>
            {isLast ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </>
  );

  // Anchorless steps (the finale) reuse the shared ModalFrame (overlay + ESC +
  // overlay-click dismiss + portal + aria) — the modal stack where it fits.
  if (!rect) {
    return (
      <ModalFrame
        isOpen
        onClose={close}
        ariaLabel="Workspace tour"
        className="workspace-tour-modal"
      >
        <div ref={cardRef} tabIndex={-1} className="workspace-tour-modal-body">
          {cardBody}
        </div>
      </ModalFrame>
    );
  }

  // Anchored steps keep the spotlight render: a transparent scrim whose ring's
  // box-shadow IS the surrounding dim, plus a card positioned by the anchor.
  return createPortal(
    <div className="workspace-tour">
      <div className="workspace-tour-scrim" onClick={close} />
      <div
        className="workspace-tour-ring"
        style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
        }}
      />
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Workspace tour"
        className={`workspace-tour-card${cardCentered ? ' centered' : ''}`}
        style={cardCentered ? undefined : cardStyle}
      >
        {cardBody}
      </div>
    </div>,
    document.body
  );
}
