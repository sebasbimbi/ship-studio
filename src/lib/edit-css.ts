/**
 * Visual editor — CSS Mode bindings (class-based CSS rule editing for
 * HTML/CSS-style projects, e.g. vanilla Astro). Wraps the Rust engine in
 * `src-tauri/src/commands/edit_css.rs`.
 *
 * This is a SEPARATE feature from the Tailwind visual editor (`lib/edit.ts`):
 * same selection/preview experience, but a style change here edits a CSS rule
 * (`padding: 24px`, any property/value) instead of a Tailwind utility token.
 */

import { invoke } from '@tauri-apps/api/core';
import type { ElementSignature } from './edit';

/** One CSS declaration on a rule (mirrors the Rust `Declaration`). */
export interface CssDeclaration {
  property: string;
  value: string;
  important: boolean;
}

/** A source location (shared shape with the Tailwind resolver). */
export interface CssLocation {
  file: string;
  line: number;
  column: number;
}

/** Outcome of resolving an element to its CSS rule (mirrors the Rust enum,
 *  `#[serde(tag = "status", rename_all = "snake_case")]`). */
export type CssResolution =
  | {
      status: 'resolved';
      /** Project-relative POSIX stylesheet path. */
      file: string;
      /** The class selector resolved, e.g. `.hero-title`. */
      selector: string;
      line: number;
      /** `min-width` of the enclosing `@media`, or null for the base layer. */
      media_min_px: number | null;
      declarations: CssDeclaration[];
    }
  | { status: 'multiple'; selector: string; locations: CssLocation[] }
  | { status: 'inline'; reason: string }
  | { status: 'needs_class'; reason: string }
  | { status: 'not_found'; selector: string };

/** Element signature for CSS resolution. Built from the in-iframe selection
 *  script's payload (`ElementSignature`); camelCase to match the Rust command. */
export interface CssSignature {
  className: string;
  tagName: string;
  /** Which class token to edit (defaults backend-side to the last token). */
  targetClass?: string;
  /** Whether the element carries an inline `style=""` (drives the Inline state). */
  hasInlineStyle?: boolean;
}

/** Build a `CssSignature` from the iframe selection signature. */
export function toCssSignature(sig: ElementSignature, targetClass?: string): CssSignature {
  return { className: sig.className, tagName: sig.tagName, targetClass };
}

/** Resolve a clicked element to the CSS rule that styles its class. */
export function resolveCssRule(
  projectPath: string,
  signature: CssSignature,
  breakpointMinPx?: number | null
): Promise<CssResolution> {
  return invoke<CssResolution>('resolve_css_rule', {
    projectPath,
    signature,
    breakpointMinPx: breakpointMinPx ?? null,
  });
}

/** Surgically set (or remove, when `value` is null) one declaration on the rule
 *  for `selector`. Fail-closed if the rule can't be pinned to one block. */
export function setCssDeclaration(
  projectPath: string,
  file: string,
  selector: string,
  property: string,
  value: string | null,
  breakpointMinPx?: number | null
): Promise<void> {
  return invoke<void>('set_css_declaration', {
    projectPath,
    file,
    selector,
    breakpointMinPx: breakpointMinPx ?? null,
    property,
    value,
  });
}

/** Append a new rule for `selector` to the authored stylesheet `file`. */
export function createCssClass(
  projectPath: string,
  file: string,
  selector: string,
  declarations: CssDeclaration[],
  breakpointMinPx?: number | null
): Promise<void> {
  return invoke<void>('create_css_class', {
    projectPath,
    file,
    selector,
    declarations,
    breakpointMinPx: breakpointMinPx ?? null,
  });
}

/** List hand-authored stylesheets (project-relative POSIX paths). */
export function listStylesheets(projectPath: string): Promise<string[]> {
  return invoke<string[]>('list_stylesheets', { projectPath });
}
