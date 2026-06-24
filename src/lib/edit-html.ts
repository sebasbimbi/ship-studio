/**
 * Element HTML editing — resolve a selected element to its source markup span
 * and write edited markup back. Backend: `resolve_element_html` /
 * `apply_element_html` in `src-tauri/src/commands/edit.rs`.
 */

import { invoke } from '@tauri-apps/api/core';
import type { ElementSignature } from './edit';

/** The selected element's source markup and where it lives. */
export interface ElementHtml {
  file: string;
  line: number;
  /** The element's source HTML: opening tag through its matching close tag. */
  html: string;
}

/** Resolve a clicked element to its source HTML. */
export function resolveElementHtml(
  projectPath: string,
  signature: ElementSignature
): Promise<ElementHtml> {
  return invoke<ElementHtml>('resolve_element_html', { projectPath, signature });
}

/** Replace an element's source markup, verifying it still equals `oldHtml`. */
export function applyElementHtml(
  projectPath: string,
  signature: ElementSignature,
  oldHtml: string,
  newHtml: string
): Promise<void> {
  return invoke<void>('apply_element_html', { projectPath, signature, oldHtml, newHtml });
}
