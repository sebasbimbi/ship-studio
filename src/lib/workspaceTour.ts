/**
 * Definition + persistence for the first-run workspace tour.
 *
 * A short guided walkthrough that runs the first time a project workspace
 * opens, pointing a non-developer at the core build loop (talk to the AI →
 * see the live preview → refine). Steps anchor to the existing
 * `data-education-id` elements; a null anchor renders a centered card.
 *
 * @module lib/workspaceTour
 */

const SEEN_KEY = 'shipstudio.hasSeenWorkspaceTour';

/** A single tour step. */
export interface TourStep {
  /** `data-education-id` of the element to spotlight, or null for a centered card. */
  anchor: string | null;
  title: string;
  body: string;
}

/** The ordered steps. Kept short and focused on the first-win build loop. */
export const WORKSPACE_TOUR_STEPS: TourStep[] = [
  {
    anchor: 'claude-terminal',
    title: 'Your AI builder',
    body: 'This is where you talk to your AI. Type what you want to build in plain English (like "a landing page for a coffee shop") and press Enter. It writes the code for you.',
  },
  {
    anchor: 'preview-viewport',
    title: 'Your live site',
    body: "Your site appears here the moment it's ready. The first load can take a minute the first time, which is normal.",
  },
  {
    anchor: 'breakpoints',
    title: 'Phone and tablet',
    body: 'Switch screen sizes here to see how your site looks on a phone or tablet, not just desktop.',
  },
  {
    anchor: 'screenshot-button',
    title: "Show, don't tell",
    body: 'Snap a screenshot of your preview and it goes straight to your AI. Perfect for "make this part look like this".',
  },
  {
    anchor: null,
    title: "You're set",
    body: `That's the loop: describe it, watch the preview, refine. You can replay this tour anytime from the command menu (Cmd+K, then "Take the tour").`,
  },
];

/** Whether the user has already finished or skipped the tour. */
export function hasSeenWorkspaceTour(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // if storage is unavailable, don't nag
  }
}

/** Mark the tour as seen so it won't auto-run again. */
export function markWorkspaceTourSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // ignore — worst case the tour shows again next launch
  }
}
