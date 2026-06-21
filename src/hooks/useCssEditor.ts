/**
 * CSS-Mode visual editor controller — a SEPARATE feature from the Tailwind
 * visual editor (`useVisualEditor`), with the same selection/preview experience
 * but a CSS-rule write model: a clicked element resolves to the CSS rule its
 * class points at, and edits set declarations on that rule (any property, any
 * value) which apply to every element sharing the class.
 *
 * It reuses the in-iframe `ss:*` postMessage protocol (`select_script.html`):
 * - `ss:activate` / `ss:deactivate` toggle the selection layer (re-armed on HMR).
 * - `ss:select` reports the clicked element's signature.
 * - `ss:mutateClass` injects raw declarations scoped to the class selector for
 *   instant live preview (no write) — this IS the class-first model.
 * - `ss:suppressReload` + `ss:commit` bracket a write so the dev server's reload
 *   doesn't briefly revert the just-saved edit.
 *
 * Backend boundary: `lib/edit-css` over `commands/edit_css.rs`. Security: only
 * messages from the preview iframe's own contentWindow are trusted (it hosts
 * untrusted project content).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resolveCssRule,
  setCssDeclaration,
  createCssClass,
  listStylesheets,
  toCssSignature,
  type CssResolution,
  type CssDeclaration,
} from '../lib/edit-css';
import type { ElementSignature } from '../lib/edit';
import { logger } from '../lib/logger';
import { trackEvent } from '../lib/analytics';

export interface CssSelection {
  signature: ElementSignature;
  /** null while the backend resolve is in flight. */
  resolution: CssResolution | null;
  /** How many elements on the page share this class (a save updates all). */
  instanceCount: number;
}

interface Params {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  projectPath: string;
  /** Feature availability (server ready + a CSS-mode project type). */
  enabled: boolean;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

export function useCssEditor({ iframeRef, projectPath, enabled, onToast }: Params) {
  const [editModeOn, setEditModeOn] = useState(false);
  const editMode = enabled && editModeOn;

  const [selection, setSelection] = useState<CssSelection | null>(null);
  const [authoredSheets, setAuthoredSheets] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Mirror edit-mode direction + per-session counters for lifecycle analytics.
  const editModeOnRef = useRef(false);
  useEffect(() => {
    editModeOnRef.current = editModeOn;
  }, [editModeOn]);
  const editStartedAtRef = useRef<number | null>(null);
  const editsCommittedRef = useRef(0);

  // Staleness token: a value resolve/save that started before a newer selection
  // must not clobber it.
  const selTokenRef = useRef(0);

  const post = useCallback(
    (msg: unknown) => iframeRef.current?.contentWindow?.postMessage(msg, '*'),
    [iframeRef]
  );

  // Activate the in-iframe selection layer while editing; re-arm across HMR
  // reloads (each reload resets the script to inert).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (editMode) {
      post({ type: 'ss:activate' });
      const reactivate = () => post({ type: 'ss:activate' });
      iframe?.addEventListener('load', reactivate);
      return () => iframe?.removeEventListener('load', reactivate);
    }
    post({ type: 'ss:deactivate' });
  }, [editMode, post, iframeRef]);

  // Load the project's stylesheets when edit mode opens (the create-rule target).
  useEffect(() => {
    if (!editMode) return;
    let cancelled = false;
    void listStylesheets(projectPath)
      .then((sheets) => !cancelled && setAuthoredSheets(sheets))
      .catch(() => !cancelled && setAuthoredSheets([]));
    return () => {
      cancelled = true;
    };
  }, [editMode, projectPath]);

  // Resolve clicked elements to their CSS rule.
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: MessageEvent) => {
      // SECURITY: only trust messages from the actual preview iframe.
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as { type?: string; signature?: ElementSignature; count?: number } | null;
      if (!d || d.type !== 'ss:select' || !d.signature) return;

      const sig = d.signature;
      const instanceCount = d.count ?? 1;
      const token = ++selTokenRef.current;
      setSelection({ signature: sig, resolution: null, instanceCount });
      void trackEvent('visual_element_selected', {
        mode: 'css',
        tag: sig.tagName,
        instance_count: instanceCount,
      });
      // Clear any leftover class preview from a prior selection.
      post({ type: 'ss:clearClassPreview' });

      void (async () => {
        try {
          const resolution = await resolveCssRule(projectPath, toCssSignature(sig));
          if (selTokenRef.current === token) {
            setSelection({ signature: sig, resolution, instanceCount });
          }
        } catch (err) {
          logger.error('[CssEditor] resolve failed', { error: String(err) });
          if (selTokenRef.current === token) {
            setSelection({
              signature: sig,
              resolution: { status: 'not_found', selector: '' },
              instanceCount,
            });
          }
        }
      })();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [editMode, projectPath, post, iframeRef]);

  /** The active resolved rule, or null when the selection isn't an editable rule. */
  const resolvedRule = selection?.resolution?.status === 'resolved' ? selection.resolution : null;

  /** Live-preview a single property on the resolved rule's selector (no write). */
  const previewDeclaration = useCallback(
    (property: string, value: string | null) => {
      if (!resolvedRule) return;
      post({
        type: 'ss:mutateClass',
        selector: resolvedRule.selector,
        rules: [{ minPx: resolvedRule.media_min_px ?? 0, decls: { [property]: value } }],
      });
    },
    [post, resolvedRule]
  );

  /** Persist one declaration (or remove it when `value` is null) to source. */
  const saveDeclaration = useCallback(
    async (property: string, value: string | null) => {
      if (!resolvedRule) return;
      const { file, selector, media_min_px } = resolvedRule;
      post({ type: 'ss:suppressReload' });
      setSaving(true);
      try {
        await setCssDeclaration(projectPath, file, selector, property, value, media_min_px);
        // Advance the local declarations so consecutive edits keep working.
        setSelection((prev) => {
          if (prev?.resolution?.status !== 'resolved') return prev;
          const decls = prev.resolution.declarations.filter(
            (d) => d.property.toLowerCase() !== property.toLowerCase()
          );
          if (value !== null) decls.push({ property, value, important: false });
          return { ...prev, resolution: { ...prev.resolution, declarations: decls } };
        });
        post({ type: 'ss:commit' });
        editsCommittedRef.current += 1;
        void trackEvent('visual_style_saved', { mode: 'css', removed: value === null });
      } catch (err) {
        logger.error('[CssEditor] write-back failed', { error: String(err) });
        onToast?.(String(err), 'error');
      } finally {
        setSaving(false);
      }
    },
    [projectPath, onToast, post, resolvedRule]
  );

  /** Create a rule for the current selection's class (the `not_found` case) in
   *  the chosen authored stylesheet, then re-resolve so it becomes editable. */
  const createRule = useCallback(
    async (file: string, selector: string, declarations: CssDeclaration[] = []) => {
      const sel = selection;
      if (!sel) return;
      try {
        await createCssClass(projectPath, file, selector, declarations);
        const resolution = await resolveCssRule(projectPath, toCssSignature(sel.signature));
        setSelection({ ...sel, resolution });
        void trackEvent('visual_style_saved', { mode: 'css', created_rule: true });
        onToast?.(`Created ${selector}`, 'success');
      } catch (err) {
        logger.error('[CssEditor] create rule failed', { error: String(err) });
        onToast?.(String(err), 'error');
      }
    },
    [projectPath, onToast, selection]
  );

  const toggleEditMode = useCallback(() => {
    const turningOn = !editModeOnRef.current;
    editModeOnRef.current = turningOn;
    if (turningOn) {
      editStartedAtRef.current = Date.now();
      editsCommittedRef.current = 0;
      void trackEvent('visual_edit_started', { mode: 'css' });
    } else {
      const startedAt = editStartedAtRef.current;
      void trackEvent('visual_edit_stopped', {
        mode: 'css',
        duration_ms: startedAt != null ? Date.now() - startedAt : undefined,
        edits_committed: editsCommittedRef.current,
      });
      editStartedAtRef.current = null;
    }
    setEditModeOn((prev) => {
      if (prev) setSelection(null);
      return !prev;
    });
  }, []);

  return {
    editMode,
    toggleEditMode,
    selection,
    authoredSheets,
    saving,
    previewDeclaration,
    saveDeclaration,
    createRule,
  };
}
