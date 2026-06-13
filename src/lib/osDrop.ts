/**
 * Helpers for routing OS file drops (Tauri `onDragDropEvent`) to the right
 * region of the UI.
 *
 * Tauri reports drag positions in PHYSICAL pixels relative to the webview;
 * `document.elementFromPoint` wants CSS pixels. These helpers convert and
 * hit-test, and expose the `[data-os-drop-zone]` convention: any region that
 * handles its own OS drops marks itself with that attribute, and other global
 * drop listeners (e.g. the terminal's paste-on-drop) skip drops that land on
 * such a zone so a single drop isn't handled twice.
 *
 * @module lib/osDrop
 */

/** A Tauri physical drag position (`{ x, y }` in physical pixels). */
export interface PhysicalPosition {
  x: number;
  y: number;
}

/** The DOM element under a physical drag position (CSS-pixel converted). */
export function elementAtPhysical(pos: PhysicalPosition): Element | null {
  const dpr = window.devicePixelRatio || 1;
  return document.elementFromPoint(pos.x / dpr, pos.y / dpr);
}

/**
 * The nearest `[data-os-drop-zone]` ancestor under `pos`, or null. Used by
 * region owners to claim a drop, and by other global drop listeners to bow out.
 */
export function osDropZoneAt(pos: PhysicalPosition): HTMLElement | null {
  return elementAtPhysical(pos)?.closest<HTMLElement>('[data-os-drop-zone]') ?? null;
}
