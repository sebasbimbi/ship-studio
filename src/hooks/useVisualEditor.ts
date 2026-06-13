/**
 * Visual editor controller — owns edit-mode state and the postMessage bridge
 * to the in-iframe selection script (`SELECT_SCRIPT` in
 * `src-tauri/src/proxy/mod.rs`).
 *
 * Lifecycle: toggle on → post `ss:activate` (re-posted on every iframe `load`,
 * since the script re-initializes inert on each HMR reload) → an `ss:select`
 * click resolves to source via the backend (class resolution, plus parallel
 * text/image resolutions guarded by a staleness token) → edits (`applyToken`,
 * `setBoxSide`, `stepSpacing`, `reset`) twMerge the live class and post
 * `ss:mutate` with breakpoint-scoped preview rules (instant DOM feedback, no
 * write).
 *
 * Commit model — accumulate then batch (the Edit/Redline unification):
 * editing NEVER writes to disk. `stageCurrentEdit()` snapshots the dirty class
 * into a `PendingEdit` and posts `ss:commit`, which FREEZES the live preview as
 * "kept" WITHOUT writing — the freeze is decoupled from the write. Text/image
 * edits stage the same way (the preview already reflects them). The queue
 * persists across selection changes and mode toggles; only `applyAllEdits()`
 * (which replays every queued write via the lib's drift-guarded byte-splices)
 * or `discardAllEdits()` empties it. `discardEdit(id)` posts `ss:revertMark` to
 * un-freeze a single staged preview.
 *
 * Exposes `editMode`, `selection` (now carrying the redline `locator`),
 * `currentClass`, text/image resolutions, `multiTarget`, the staging callbacks,
 * and `pendingEdits` / `applyAllEdits` / `discardEdit[s]` — consumed by
 * Preview.tsx, which threads them into the unified VisualEditorPanel and the
 * Apply-all tray.
 *
 * Boundaries: lib/edit wrappers (`resolveClassnameSource`, `applyClassnameEdit
 * [Multi]`, `resolveTextSource`/`applyTextEdit`, `resolveImageSource`/
 * `applySrcEdit`, `findComponentUsage`) over the Rust edit backend; the iframe
 * `ss:*` message protocol (incl. `ss:commit` to freeze and `ss:revertMark` to
 * un-freeze a staged preview).
 *
 * Gotchas: incoming messages are trusted only when `e.source` is the preview
 * iframe's contentWindow — the iframe hosts untrusted project content, and a
 * forged `ss:textCommit` would otherwise touch the user's files. `applyAllEdits`
 * arms `ss:suppressReload` ONCE before replaying: Astro's full reload can beat
 * the staged preview, briefly reverting it. Live values (`currentClass`,
 * text/image targets) are mirrored into refs so the staging callbacks read fresh
 * state without re-subscribing the message handler.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { twMerge } from 'tailwind-merge';
import {
  resolveClassnameSource,
  applyClassnameEdit,
  applyClassnameEditMulti,
  resolveTextSource,
  applyTextEdit,
  resolveImageSource,
  applySrcEdit,
  findComponentUsage,
  spacingValue,
  spacingTokenFor,
  spacingCss,
  stepSpacingValue,
  boxSide,
  boxSidePrefix,
  withVariant,
  tokensForVariant,
  removeAtLayer,
  breakpointPrefixes,
  competesWithUnlayered,
  markImportant,
  SPACING_CONTROLS,
  type SpacingKind,
  type BoxType,
  type Side,
  type Breakpoint,
  type SpacingValue,
  type ResetSpec,
  type ElementSignature,
  type Resolution,
  type TextResolution,
  type ImageResolution,
  type UsageReport,
} from '../lib/edit';
import type { RedlineLocator } from '../lib/redline';
import { logger } from '../lib/logger';

/** A breakpoint-scoped slice of the live-preview stylesheet: `decls` applied at
 *  `minPx` and up (0 = base, all widths). A null value deletes that property from
 *  the preview (Reset). Mirrors `select_script.html`'s contract. */
interface PreviewRule {
  minPx: number;
  decls: Record<string, string | null>;
}

/**
 * A staged edit waiting in the queue: the preview is already frozen (its
 * `ss:commit` fired) but nothing has been written to source. `mark` is the
 * in-iframe selection marker (`data-ss-sel`) that froze the preview — sent back
 * via `ss:revertMark` to un-freeze it if the edit is discarded. `signature` is
 * the clicked-element snapshot (carried for the request/changelog handoff).
 * Coalesced by `kind:file:line`: re-staging the same dimension of the same
 * element replaces its queued entry.
 */
export type PendingEdit = {
  id: string;
  /** The frozen-preview marker to revert (`ss:revertMark`). */
  mark: string;
  signature: ElementSignature;
} & (
  | {
      kind: 'class';
      /** Single resolved location, or null for a multi-location write. */
      resolution: Resolution;
      /** For a 'multi' resolution: write all spots or one (index). */
      multiTarget: 'all' | number;
      /** Drift baseline (the resolution's `class_name` at stage time). */
      fromClass: string;
      /** The final merged class to write. */
      toClass: string;
    }
  | {
      kind: 'text';
      file: string;
      line: number;
      column: number;
      fromText: string;
      toText: string;
    }
  | {
      kind: 'image';
      file: string;
      line: number;
      column: number;
      fromSrc: string;
      toSrc: string;
    }
);

/** The coalescing key for a pending edit: one entry per element-dimension. A
 *  class edit and a text edit on the same line are distinct dimensions and both
 *  survive; re-staging the same dimension replaces. */
function editKey(e: PendingEdit): string {
  if (e.kind === 'class') {
    const r = e.resolution;
    const loc = r.status === 'resolved' ? r : r.status === 'multi' ? r.locations[0] : null;
    return loc ? `class:${loc.file}:${loc.line}` : `class:${e.mark}`;
  }
  return `${e.kind}:${e.file}:${e.line}`;
}

interface Params {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  projectPath: string;
  /** Feature availability (e.g. Next.js project + server ready). */
  enabled: boolean;
  /** The breakpoint layer edits target (Base = unprefixed). Drives the variant
   *  prefix on written tokens and the min-width of the live-preview rule. */
  activeBreakpoint: Breakpoint;
  /** All breakpoints (incl. Base) — used to recognize/strip variant prefixes. */
  breakpoints: Breakpoint[];
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

export interface Selection {
  signature: ElementSignature;
  /** null while the backend resolve is in flight. */
  resolution: Resolution | null;
  /** How many elements on the page share these exact classes (same source ⇒ a
   *  save updates all of them). 1 for a unique element. */
  instanceCount: number;
  /** Redundant DOM locator from the `ss:select` payload — the redline
   *  "Request a change" handoff captures it so an agent can relocate the element. */
  locator: RedlineLocator;
  /** The in-iframe selection marker (`data-ss-sel`) — captured so a staged edit
   *  can later be reverted via `ss:revertMark`. */
  mark: string;
}

/** A neutral locator for the rare case the iframe omits one (defensive — the
 *  unified `ss:select` payload always carries it). */
const EMPTY_LOCATOR: RedlineLocator = {
  tag: '',
  id: null,
  classList: [],
  role: null,
  ariaLabel: null,
  textSnippet: null,
  dataAttributes: {},
  ancestorClasses: [],
  nearbyLandmark: null,
};

export function useVisualEditor({
  iframeRef,
  projectPath,
  enabled,
  activeBreakpoint,
  breakpoints,
  onToast,
}: Params) {
  // User intent; the *effective* mode below also requires the feature be enabled,
  // so it flips off automatically when the server restarts (no reset effect).
  const [editModeOn, setEditModeOn] = useState(false);
  const editMode = enabled && editModeOn;

  // Known breakpoint prefixes, for scoping a class string to one variant layer.
  const known = useMemo(() => breakpointPrefixes(breakpoints), [breakpoints]);

  const [selection, setSelection] = useState<Selection | null>(null);
  // Where the selected element's component is used project-wide (scope hint).
  // Best-effort, fetched after a single-location resolve. Token guards staleness.
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const usageTokenRef = useRef(0);
  /** The class string currently applied live in the iframe (merge baseline). */
  const [currentClass, setCurrentClass] = useState('');
  // Mirror into a ref so `applyToken`/`stageCurrentEdit` callbacks read the latest
  // value without re-subscribing. Written only through `setLiveClass` (never in render).
  const currentClassRef = useRef('');
  const setLiveClass = useCallback((value: string) => {
    currentClassRef.current = value;
    setCurrentClass(value);
  }, []);

  // CSS properties the selected element gets from unlayered custom CSS (which beats
  // Tailwind utilities). Edits touching these get the important modifier so the saved
  // class wins the cascade — matching what the !important live preview already shows.
  const unlayeredPropsRef = useRef<string[] | undefined>(undefined);
  useEffect(() => {
    unlayeredPropsRef.current = selection?.signature.unlayeredProps;
  }, [selection]);

  // For a 'multi' resolution (one class string at several source spots): which to
  // write — 'all' (default) or a single location index. Reset on each new selection.
  const [multiTarget, setMultiTargetState] = useState<'all' | number>('all');
  const multiTargetRef = useRef<'all' | number>('all');
  const setMultiTarget = useCallback((t: 'all' | number) => {
    multiTargetRef.current = t;
    setMultiTargetState(t);
  }, []);

  // Inline text editing: the resolved text target for the current selection (null
  // when the element's text isn't a plain editable literal). Mirrored into a ref so
  // the ss:textCommit handler reads the latest without re-subscribing. `text` is the
  // source baseline used as the drift guard on write-back.
  const [textResolution, setTextResolution] = useState<TextResolution | null>(null);
  // Bumps each time a double-click lands on dynamic text the iframe bounced out of
  // — drives a one-shot pulse on the DynamicTextHelp hand-off so the user notices it.
  const [textBlockedNonce, setTextBlockedNonce] = useState(0);
  const textTargetRef = useRef<{ file: string; line: number; column: number; text: string } | null>(
    null
  );
  const setTextTarget = useCallback((res: TextResolution | null) => {
    textTargetRef.current =
      res?.status === 'resolved'
        ? { file: res.file, line: res.line, column: res.column, text: res.text }
        : null;
    setTextResolution(res);
  }, []);
  // The signature of the current selection, mirrored for on-demand text resolution if
  // a commit arrives before the (async) select-time resolve has landed.
  const selectedSigRef = useRef<ElementSignature | null>(null);

  // Image src editing: the resolved src target for the current selection (null when
  // the element isn't an image or its src isn't a static literal). Mirrored into a
  // ref so `stageImageEdit` reads the latest baseline without re-subscribing.
  const [imageResolution, setImageResolution] = useState<ImageResolution | null>(null);
  const imageTargetRef = useRef<{
    file: string;
    line: number;
    column: number;
    src: string;
  } | null>(null);
  const setImageTarget = useCallback((res: ImageResolution | null) => {
    imageTargetRef.current =
      res?.status === 'resolved'
        ? { file: res.file, line: res.line, column: res.column, src: res.src }
        : null;
    setImageResolution(res);
  }, []);

  // The accumulate-then-batch queue. Each entry's preview is already frozen
  // (ss:commit fired); nothing is written until applyAllEdits replays them.
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  // Mirror so the message handler + toggleEditMode read the latest queue without
  // re-subscribing, and so stageCurrentEdit can dedupe synchronously.
  const pendingRef = useRef<PendingEdit[]>([]);
  const setPending = useCallback((next: PendingEdit[]) => {
    pendingRef.current = next;
    setPendingEdits(next);
  }, []);
  /** Enqueue an edit, coalescing by `editKey` so re-staging the same
   *  element-dimension replaces its prior entry (rather than double-writing). */
  const enqueue = useCallback(
    (edit: PendingEdit) => {
      const key = editKey(edit);
      const next = pendingRef.current.filter((e) => editKey(e) !== key);
      next.push(edit);
      setPending(next);
    },
    [setPending]
  );

  const post = useCallback(
    (msg: unknown) => iframeRef.current?.contentWindow?.postMessage(msg, '*'),
    [iframeRef]
  );

  const newId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Activate/deactivate the in-iframe selection layer (external-system sync), and
  // keep it active across HMR reloads (each reload resets the script to inert).
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

  /**
   * Snapshot the current selection's dirty class into a `PendingEdit` and FREEZE
   * its preview (post `ss:commit`) — no write. Generalized from the old immediate
   * `commit`: the actual disk write now happens later in `applyAllEdits`. A no-op
   * when the class is clean (live == source) or the element isn't class-editable.
   */
  const stageCurrentEdit = useCallback(() => {
    const sel = selection;
    const res = sel?.resolution;
    if (!sel || !res || (res.status !== 'resolved' && res.status !== 'multi')) return;
    const toClass = currentClassRef.current;
    if (toClass === res.class_name) return; // clean — nothing to stage
    enqueue({
      id: newId(),
      mark: sel.mark,
      signature: sel.signature,
      kind: 'class',
      resolution: res,
      multiTarget: multiTargetRef.current,
      fromClass: res.class_name,
      toClass,
    });
    // Freeze the live preview as "kept" so deactivating / selecting elsewhere
    // doesn't revert it. ss:commit decouples freeze from write — the write is
    // replayed by applyAllEdits.
    post({ type: 'ss:commit' });
  }, [selection, enqueue, post]);

  // Resolve clicked elements + handle inline text-edit commits from the iframe.
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: MessageEvent) => {
      // SECURITY: only trust messages from the actual preview iframe. The iframe
      // hosts untrusted project content; a forged `ss:textCommit` from another
      // frame would otherwise touch the user's source files.
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as {
        type?: string;
        signature?: ElementSignature;
        count?: number;
        leafText?: boolean;
        text?: string;
        locator?: RedlineLocator;
        mark?: string | number;
      } | null;
      if (!d) return;

      // The element turned out not to be editable (dynamic text) — the iframe bounced
      // out of the optimistic edit. No toast: the panel shows the "copy a request for
      // your agent" hand-off (DynamicTextHelp) for the still-selected element.
      if (d.type === 'ss:textBlocked') {
        setTextBlockedNonce((n) => n + 1);
        return;
      }

      // Inline text edit was confirmed in the iframe — STAGE it (the preview already
      // shows the new text; freeze it and enqueue, do NOT write).
      if (d.type === 'ss:textCommit' && typeof d.text === 'string') {
        const next = d.text;
        const sig = selectedSigRef.current;
        void (async () => {
          try {
            // The select-time resolve may not have landed yet (fast double-click →
            // type → commit); resolve on demand so the edit is never dropped silently.
            let target = textTargetRef.current;
            if (!target) {
              if (!sig) throw new Error('Lost track of this element — reselect it and try again.');
              const res = await resolveTextSource(projectPath, sig);
              if (res.status !== 'resolved')
                throw new Error(res.reason || 'This text isn’t editable.');
              target = { file: res.file, line: res.line, column: res.column, text: res.text };
              textTargetRef.current = target;
            }
            if (next === target.text) {
              post({ type: 'ss:commit' }); // unchanged — just freeze, no enqueue
              return;
            }
            enqueue({
              id: newId(),
              mark: selection?.mark ?? '',
              signature: sig ?? selection!.signature,
              kind: 'text',
              file: target.file,
              line: target.line,
              column: target.column,
              fromText: target.text,
              toText: next,
            });
            // Advance the local drift baseline so consecutive text edits keep working
            // (each stages against the prior staged value, applied in order).
            target.text = next;
            setTextResolution((prev) =>
              prev?.status === 'resolved' ? { ...prev, text: next } : prev
            );
            post({ type: 'ss:commit' }); // freeze the preview as kept
          } catch (err) {
            logger.error('[VisualEditor] text stage failed', { error: String(err) });
            onToast?.(String(err), 'error');
            // Couldn't stage — put the original text back in the preview.
            post({ type: 'ss:textRevert' });
          }
        })();
        return;
      }

      if (d.type !== 'ss:select' || !d.signature) return;
      // A click landed on a DIFFERENT element. If the outgoing selection is dirty,
      // stage it first so the iframe keeps its preview (its ss:commit fires now)
      // before the marker advances to the new element.
      stageCurrentEdit();
      const sig = d.signature;
      const instanceCount = d.count ?? 1;
      const leafText = !!d.leafText;
      const locator = d.locator ?? EMPTY_LOCATOR;
      const mark = d.mark != null ? String(d.mark) : '';
      selectedSigRef.current = sig;
      setSelection({ signature: sig, resolution: null, instanceCount, locator, mark });
      setLiveClass(sig.className);
      setMultiTarget('all'); // a fresh selection defaults to editing all occurrences
      setUsage(null);
      setTextTarget(null); // optimistic; iframe allows editing until told otherwise
      setImageTarget(null);
      const usageToken = ++usageTokenRef.current;
      void (async () => {
        try {
          const resolution = await resolveClassnameSource(projectPath, sig);
          if (usageTokenRef.current !== usageToken) return; // selection moved on
          setSelection((prev) => (prev && prev.signature === sig ? { ...prev, resolution } : prev));
          // Best-effort scope hint: where else this component is rendered.
          if (resolution.status === 'resolved') {
            try {
              const report = await findComponentUsage(
                projectPath,
                resolution.file,
                resolution.line
              );
              if (usageTokenRef.current === usageToken) setUsage(report);
            } catch {
              /* scope hint is optional */
            }
          }
        } catch (err) {
          logger.error('[VisualEditor] resolve failed', { error: String(err) });
          if (usageTokenRef.current !== usageToken) return;
          onToast?.(String(err), 'error');
          setSelection((prev) =>
            prev && prev.signature === sig
              ? {
                  ...prev,
                  resolution: {
                    status: 'read_only',
                    reason: 'Could not resolve this element to source.',
                  },
                }
              : prev
          );
        }
      })();
      // Text-editability runs in parallel: only for single-text-node leaves. The
      // iframe gates inline editing on the verdict we post back (ss:textInfo).
      if (leafText) {
        void (async () => {
          try {
            const textRes = await resolveTextSource(projectPath, sig);
            // Ignore if the selection changed underneath us.
            if (usageTokenRef.current !== usageToken) return;
            setTextTarget(textRes);
            post({ type: 'ss:textInfo', editable: textRes.status === 'resolved' });
          } catch {
            if (usageTokenRef.current === usageToken)
              post({ type: 'ss:textInfo', editable: false });
          }
        })();
      } else {
        post({ type: 'ss:textInfo', editable: false });
      }
      // Image src resolution runs in parallel for <img> elements — drives the
      // panel's Image section (current asset + Replace).
      if (sig.tagName === 'img') {
        void (async () => {
          try {
            const imgRes = await resolveImageSource(projectPath, sig);
            // Ignore if the selection changed underneath us.
            if (usageTokenRef.current === usageToken) setImageTarget(imgRes);
          } catch (err) {
            logger.error('[VisualEditor] image resolve failed', { error: String(err) });
            if (usageTokenRef.current === usageToken)
              setImageTarget({
                status: 'read_only',
                reason: 'Could not resolve this image to source.',
              });
          }
        })();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [
    editMode,
    projectPath,
    onToast,
    post,
    iframeRef,
    selection,
    enqueue,
    stageCurrentEdit,
    setLiveClass,
    setMultiTarget,
    setTextTarget,
    setImageTarget,
  ]);

  /**
   * Merge a Tailwind token into the live class at the active breakpoint and
   * preview it (no write). `token` is the BARE (unprefixed) utility — we add the
   * active breakpoint's variant prefix here, so callers stay breakpoint-agnostic.
   *
   * `style` is the CSS the token resolves to, sent as a breakpoint-scoped preview
   * rule. It exists because Tailwind's JIT only emits CSS for classes found in
   * source — a freshly-typed `md:p-14` has no compiled rule, so the class alone
   * shows nothing until saved. The rule (at the breakpoint's min-width) drives a
   * truthful preview: a `md:` edit only shows ≥768px, unlike an inline style.
   */
  const applyToken = useCallback(
    (token: string, style?: Record<string, string>) => {
      // Mark important when the edited property is set by unlayered custom CSS, so
      // the saved utility wins the cascade (the live preview already wins via !important).
      const bare =
        style && competesWithUnlayered(Object.keys(style), unlayeredPropsRef.current)
          ? markImportant(token)
          : token;
      const merged = twMerge(currentClassRef.current, withVariant(activeBreakpoint.prefix, bare));
      setLiveClass(merged);
      const rules: PreviewRule[] = style ? [{ minPx: activeBreakpoint.minPx, decls: style }] : [];
      post({ type: 'ss:mutate', className: merged, rules });
    },
    [post, setLiveClass, activeBreakpoint]
  );

  /** Set one side of a box (padding/margin) at the active breakpoint to a scale
   *  step or arbitrary value. Previews only the sides this layer actually defines
   *  (so unset sides fall through to the real, already-compiled base CSS). */
  const setBoxSide = useCallback(
    (type: BoxType, side: Side, value: SpacingValue) => {
      const bare = spacingTokenFor(boxSidePrefix(type, side), value);
      const token = competesWithUnlayered([`${type}-${side}`], unlayeredPropsRef.current)
        ? markImportant(bare)
        : bare;
      const merged = twMerge(currentClassRef.current, withVariant(activeBreakpoint.prefix, token));
      setLiveClass(merged);
      const scoped = tokensForVariant(merged, activeBreakpoint.prefix, known);
      const decls: Record<string, string> = {};
      for (const s of ['top', 'right', 'bottom', 'left'] as Side[]) {
        const v = boxSide(scoped, type, s);
        if (v) decls[`${type}-${s}`] = spacingCss(v);
      }
      post({
        type: 'ss:mutate',
        className: merged,
        rules: [{ minPx: activeBreakpoint.minPx, decls }],
      });
    },
    [post, setLiveClass, activeBreakpoint, known]
  );

  /** Step a spacing utility (padding/margin/gap) by one unit at the active
   *  breakpoint, computed from that layer's current value (so stepping `md:` reads
   *  the md value, not base). Steps the scale integer, or a numeric arbitrary
   *  value's magnitude (keeping its unit). Drives a breakpoint-scoped preview rule. */
  const stepSpacing = useCallback(
    (kind: SpacingKind, dir: 1 | -1) => {
      const ctrl = SPACING_CONTROLS.find((c) => c.kind === kind);
      if (!ctrl) return;
      const scoped = tokensForVariant(currentClassRef.current, activeBreakpoint.prefix, known);
      const next = stepSpacingValue(spacingValue(scoped, ctrl.prefix), dir);
      applyToken(spacingTokenFor(ctrl.prefix, next), { [ctrl.css]: spacingCss(next) });
    },
    [applyToken, activeBreakpoint, known]
  );

  /** Reset a property at the active breakpoint: remove its tokens from that layer
   *  and null out its preview decls so the value reverts to its inherited/default
   *  state. The class change is dirty, so Apply all persists the removal. */
  const reset = useCallback(
    (spec: ResetSpec) => {
      const merged = removeAtLayer(currentClassRef.current, activeBreakpoint, known, spec.match);
      if (merged === currentClassRef.current) return; // nothing to remove
      setLiveClass(merged);
      const decls: Record<string, string | null> = {};
      for (const p of spec.cssProps) decls[p] = null;
      post({
        type: 'ss:mutate',
        className: merged,
        rules: [{ minPx: activeBreakpoint.minPx, decls }],
      });
    },
    [post, setLiveClass, activeBreakpoint, known]
  );

  /**
   * Stage a new text value for the selected text leaf — the panel's "Text"
   * section path, an alternative to the inline (double-click) editor. Resolves
   * the text target on demand if the select-time resolve hasn't landed, enqueues
   * a `PendingTextEdit`, freezes the preview (`ss:commit`), advances the local
   * drift baseline, and mirrors the new text into the live preview. Resolves
   * `true` when staged, `false` (no throw) when nothing changed so the caller can
   * keep the field open. NO write — applyAllEdits writes later.
   */
  const stageTextEdit = useCallback(
    async (next: string): Promise<boolean> => {
      const sig = selectedSigRef.current;
      try {
        let target = textTargetRef.current;
        if (!target) {
          if (!sig) throw new Error('Lost track of this element — reselect it and try again.');
          const res = await resolveTextSource(projectPath, sig);
          if (res.status !== 'resolved') throw new Error(res.reason || 'This text isn’t editable.');
          target = { file: res.file, line: res.line, column: res.column, text: res.text };
          textTargetRef.current = target;
        }
        if (next === target.text) {
          post({ type: 'ss:commit' }); // unchanged — freeze, no enqueue
          return false;
        }
        enqueue({
          id: newId(),
          mark: selection?.mark ?? '',
          signature: sig ?? selection!.signature,
          kind: 'text',
          file: target.file,
          line: target.line,
          column: target.column,
          fromText: target.text,
          toText: next,
        });
        // Advance the local drift baseline so consecutive text edits keep working.
        target.text = next;
        setTextResolution((prev) => (prev?.status === 'resolved' ? { ...prev, text: next } : prev));
        // The text already shows in the preview (inline editor / live DOM); freeze
        // it as kept so closing the panel doesn't revert it before applyAll runs.
        post({ type: 'ss:commit' });
        return true;
      } catch (err) {
        logger.error('[VisualEditor] text stage failed', { error: String(err) });
        onToast?.(String(err), 'error');
        return false;
      }
    },
    [projectPath, onToast, post, enqueue, selection]
  );

  /**
   * Stage a new image src for the selected <img> — swap the preview instantly
   * (`ss:setSrc`), freeze it (`ss:commit`), and enqueue a `PendingImageEdit`.
   * Throws on a resolution failure so the picker can stay open. NO write —
   * applyAllEdits writes later.
   */
  const stageImageEdit = useCallback(
    // Returns a Promise (the picker awaits it and `.catch`es a reject) but has no
    // async work itself — the target is already resolved in the ref, so we only
    // enqueue + post. A reject mirrors the old throw-to-keep-the-picker-open contract.
    (newSrc: string): Promise<void> => {
      const target = imageTargetRef.current;
      if (!target) {
        onToast?.('Lost track of this image — reselect it and try again.', 'error');
        return Promise.reject(new Error('no image target'));
      }
      if (newSrc === target.src) return Promise.resolve(); // already this asset — nothing to stage
      enqueue({
        id: newId(),
        mark: selection?.mark ?? '',
        signature: selection!.signature,
        kind: 'image',
        file: target.file,
        line: target.line,
        column: target.column,
        fromSrc: target.src,
        toSrc: newSrc,
      });
      // Advance the drift baseline so consecutive replacements keep working.
      target.src = newSrc;
      setImageResolution((prev) => (prev?.status === 'resolved' ? { ...prev, src: newSrc } : prev));
      post({ type: 'ss:setSrc', value: newSrc }); // instant preview (HMR confirms after apply)
      post({ type: 'ss:commit' }); // freeze the preview as kept
      return Promise.resolve();
    },
    [onToast, post, enqueue, selection]
  );

  /**
   * Replay every queued edit to source as one batch. Each lib call is a
   * drift-guarded byte-splice (`oldClass`/`oldText`/`oldSrc` must still match);
   * splices preserve line numbers, so applying class edits doesn't shift the
   * lines a sibling text/image edit or a redline request points at. Arms
   * `ss:suppressReload` once up front so the burst of writes doesn't bounce the
   * preview. On full success the queue clears; failures are counted and toasted.
   */
  const applyAllEdits = useCallback(async (): Promise<{ ok: number; failed: number }> => {
    const queue = pendingRef.current;
    if (queue.length === 0) return { ok: 0, failed: 0 };
    post({ type: 'ss:suppressReload' });
    let ok = 0;
    const survivors: PendingEdit[] = [];
    for (const edit of queue) {
      try {
        if (edit.kind === 'class') {
          const res = edit.resolution;
          if (res.status === 'resolved') {
            await applyClassnameEdit(projectPath, res.file, res.line, edit.fromClass, edit.toClass);
          } else if (res.status === 'multi') {
            const edits =
              edit.multiTarget === 'all'
                ? res.locations
                : res.locations.filter((_, i) => i === edit.multiTarget);
            await applyClassnameEditMulti(projectPath, edits, edit.fromClass, edit.toClass);
          } else {
            throw new Error('Element is read-only.');
          }
        } else if (edit.kind === 'text') {
          await applyTextEdit(
            projectPath,
            edit.file,
            edit.line,
            edit.column,
            edit.fromText,
            edit.toText
          );
        } else {
          await applySrcEdit(
            projectPath,
            edit.file,
            edit.line,
            edit.column,
            edit.fromSrc,
            edit.toSrc
          );
        }
        ok++;
      } catch (err) {
        logger.error('[VisualEditor] apply-all write failed', {
          kind: edit.kind,
          error: String(err),
        });
        survivors.push(edit);
      }
    }
    const failed = survivors.length;
    if (failed === 0) {
      setPending([]); // full success — the queue is drained
      onToast?.(ok === 1 ? 'Applied 1 change' : `Applied ${ok} changes`, 'success');
    } else {
      setPending(survivors); // keep the ones that failed so the user can retry
      onToast?.(`Applied ${ok}, ${failed} failed — see the queue`, 'error');
    }
    return { ok, failed };
  }, [projectPath, onToast, post, setPending]);

  /** Drop one staged edit and un-freeze its preview (post `ss:revertMark`). */
  const discardEdit = useCallback(
    (id: string) => {
      const edit = pendingRef.current.find((e) => e.id === id);
      if (!edit) return;
      setPending(pendingRef.current.filter((e) => e.id !== id));
      if (edit.mark) post({ type: 'ss:revertMark', mark: edit.mark });
    },
    [post, setPending]
  );

  /** Drop the whole queue and un-freeze every staged preview. */
  const discardAllEdits = useCallback(() => {
    for (const edit of pendingRef.current) {
      if (edit.mark) post({ type: 'ss:revertMark', mark: edit.mark });
    }
    setPending([]);
  }, [post, setPending]);

  const toggleEditMode = useCallback(() => {
    setEditModeOn((prev) => {
      // Turning off: stage any dirty current edit (so its frozen preview is kept),
      // then clear the live selection. The queue + frozen previews PERSIST across
      // the toggle — only applyAllEdits / discardAllEdits empty them. (ss:deactivate
      // is posted by the activate effect; staged previews stay frozen since
      // ss:commit already fired for them.)
      if (prev) {
        stageCurrentEdit();
        setSelection(null);
        setLiveClass('');
        setTextTarget(null);
        setImageTarget(null);
        selectedSigRef.current = null;
      }
      return !prev;
    });
  }, [stageCurrentEdit, setLiveClass, setTextTarget, setImageTarget]);

  return {
    editMode,
    toggleEditMode,
    selection,
    currentClass,
    usage,
    /** Text-editability of the current selection (drives the panel's hint). */
    textResolution,
    /** Image-src editability of the current selection (drives the Image section). */
    imageResolution,
    /** Stage a new text value for the selected text leaf (panel "Text" section
     *  path — an alternative to the inline double-click editor). Resolves true when
     *  staged, false when nothing changed or it failed (toast shown). No write. */
    stageTextEdit,
    /** Stage a new src and swap the preview (no write — applyAllEdits writes it). */
    stageImageEdit,
    /** Bumps when a double-click hits dynamic text — pulses the hand-off block. */
    textBlockedNonce,
    multiTarget,
    setMultiTarget,
    stepSpacing,
    setBoxSide,
    // Enum controls apply an absolute token (twMerge swaps the prior one) plus an
    // inline-style preview — same path as spacing, just not relative to a scale.
    applyEnum: applyToken,
    reset,
    /** The accumulate-then-batch queue (frozen previews awaiting a write). */
    pendingEdits,
    /** Freeze the current dirty class into the queue (no write). */
    stageCurrentEdit,
    /** Replay every queued edit to source as one batch. */
    applyAllEdits,
    /** Drop one staged edit and revert its frozen preview. */
    discardEdit,
    /** Drop the whole queue and revert every frozen preview. */
    discardAllEdits,
  };
}
