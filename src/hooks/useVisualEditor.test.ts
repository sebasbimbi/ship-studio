/**
 * Accumulate-then-batch commit model for the visual editor hook (the Edit +
 * Redline unification).
 *
 * Focus: editing NEVER writes. A burst of rapid edits (like a drag) plus a
 * `stageCurrentEdit()` enqueues a SINGLE pending entry carrying the final value;
 * `applyAllEdits()` is what replays it to source — once, against the original
 * `class_name` drift baseline. Switching elements auto-stages a dirty outgoing
 * selection, re-staging the same element coalesces, and discarding a staged edit
 * posts `ss:revertMark` to un-freeze its preview. The grammar is exercised for
 * real; only the two Tauri-backed calls (resolve + write-back) are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../lib/edit', async (importActual) => {
  const actual = await importActual<typeof import('../lib/edit')>();
  return { ...actual, resolveClassnameSource: vi.fn(), applyClassnameEdit: vi.fn() };
});

import { useVisualEditor } from './useVisualEditor';
import {
  resolveClassnameSource,
  applyClassnameEdit,
  BASE_BREAKPOINT,
  DEFAULT_BREAKPOINTS,
} from '../lib/edit';

const BREAKPOINTS = [BASE_BREAKPOINT, ...DEFAULT_BREAKPOINTS];

/** A minimal iframe ref: records postMessage payloads (so we can assert the
 *  ss:commit / ss:revertMark protocol) and swallows the `load` listener the hook
 *  attaches to re-activate across HMR reloads. */
function fakeIframeRef() {
  const postMessage = vi.fn();
  return {
    ref: {
      current: {
        contentWindow: { postMessage },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    } as unknown as React.RefObject<HTMLIFrameElement | null>,
    postMessage,
  };
}

function setup() {
  const { ref: iframeRef, postMessage } = fakeIframeRef();
  const hook = renderHook(() =>
    useVisualEditor({
      iframeRef,
      projectPath: '/proj',
      enabled: true,
      activeBreakpoint: BASE_BREAKPOINT,
      breakpoints: BREAKPOINTS,
    })
  );
  return { ...hook, iframeRef, postMessage };
}

/** The message types posted to the iframe, in order (drops payload detail). */
const postedTypes = (postMessage: ReturnType<typeof vi.fn>): string[] =>
  postMessage.mock.calls.map((c) => (c[0] as { type?: string })?.type ?? '');

/** Flush pending microtasks (e.g. the async resolve) under act. */
const flush = () => act(async () => void (await Promise.resolve()));

/** Drive a selection through the in-window message bridge and resolve it.
 *  `source` mirrors the real preview iframe's contentWindow — the hook rejects
 *  messages from any other source as a security measure. `mark` is the in-iframe
 *  selection marker the hook round-trips on revert. */
async function select(className: string, source: MessageEventSource, opts: { mark?: string } = {}) {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        data: {
          type: 'ss:select',
          signature: { className, tagName: 'div', ancestorClasses: [] },
          count: 1,
          mark: opts.mark ?? '1',
        },
      })
    );
    await Promise.resolve();
  });
  await flush(); // resolveClassnameSource → setSelection
}

beforeEach(() => {
  (resolveClassnameSource as ReturnType<typeof vi.fn>).mockImplementation(
    (_p: string, sig: { className: string }) =>
      Promise.resolve({
        status: 'resolved',
        file: 'app/page.tsx',
        // A stable per-class line so distinct elements resolve to distinct
        // file:line keys (real elements never share a source location). A char-sum
        // keeps same-length class strings (p-3 / m-2) on different lines.
        line: [...sig.className].reduce((a, c) => a + c.charCodeAt(0), 0),
        column: 1,
        class_name: sig.className, // a fresh selection is clean (live == source)
        confidence: 'unique',
      })
  );
  (applyClassnameEdit as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useVisualEditor accumulate-then-batch', () => {
  it('does NOT write while editing — staging only freezes the preview', async () => {
    const { result, iframeRef, postMessage } = setup();
    act(() => result.current.toggleEditMode());
    await select('p-3', iframeRef.current!.contentWindow!);

    act(() => result.current.applyEnum('p-8', { padding: '2rem' }));
    act(() => result.current.stageCurrentEdit());

    // Staged, not written: one queue entry, an ss:commit fired, zero disk writes.
    expect(result.current.pendingEdits).toHaveLength(1);
    expect(postedTypes(postMessage)).toContain('ss:commit');
    expect(applyClassnameEdit).not.toHaveBeenCalled();
  });

  it('coalesces a burst of edits into ONE pending entry, written once with the final value', async () => {
    const { result, iframeRef } = setup();
    act(() => result.current.toggleEditMode());
    await select('p-3', iframeRef.current!.contentWindow!);

    // Simulate a drag: many rapid mutations on the same element/dimension.
    act(() => {
      result.current.setBoxSide('padding', 'top', { kind: 'scale', n: 4 });
      result.current.setBoxSide('padding', 'top', { kind: 'scale', n: 5 });
      result.current.setBoxSide('padding', 'top', { kind: 'scale', n: 6 });
      result.current.setBoxSide('padding', 'top', { kind: 'scale', n: 7 });
    });
    act(() => result.current.stageCurrentEdit());

    // One entry regardless of how many mutations the drag produced.
    expect(result.current.pendingEdits).toHaveLength(1);
    const entry = result.current.pendingEdits[0];
    expect(entry.kind).toBe('class');
    expect(applyClassnameEdit).not.toHaveBeenCalled();

    // Applying replays it once, against the original baseline + final token.
    await act(async () => {
      const res = await result.current.applyAllEdits();
      expect(res).toEqual({ ok: 1, failed: 0 });
    });
    expect(applyClassnameEdit).toHaveBeenCalledTimes(1);
    const call = (applyClassnameEdit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      number,
      string,
      string,
    ];
    expect(call[3]).toBe('p-3'); // oldClass (drift baseline)
    expect(call[4]).toContain('pt-7'); // newClass carries the final drag value
  });

  it('re-staging the same element replaces its queued entry (coalesce by file:line)', async () => {
    const { result, iframeRef } = setup();
    act(() => result.current.toggleEditMode());
    await select('p-3', iframeRef.current!.contentWindow!);

    act(() => result.current.setBoxSide('padding', 'top', { kind: 'scale', n: 4 }));
    act(() => result.current.stageCurrentEdit());
    act(() => result.current.setBoxSide('padding', 'top', { kind: 'scale', n: 9 }));
    act(() => result.current.stageCurrentEdit());

    // Still one entry (same element, same line) — the later value wins.
    expect(result.current.pendingEdits).toHaveLength(1);
    await act(async () => void (await result.current.applyAllEdits()));
    expect(applyClassnameEdit).toHaveBeenCalledTimes(1);
    const call = (applyClassnameEdit as ReturnType<typeof vi.fn>).mock.calls[0] as string[];
    expect(call[4]).toContain('pt-9');
  });

  it('auto-stages a dirty outgoing selection when a different element is clicked', async () => {
    const { result, iframeRef } = setup();
    const win = iframeRef.current!.contentWindow!;
    act(() => result.current.toggleEditMode());

    await select('p-3', win, { mark: '1' });
    act(() => result.current.setBoxSide('padding', 'top', { kind: 'scale', n: 6 }));
    // Click a different element — the dirty first edit should auto-stage.
    await select('m-2', win, { mark: '2' });

    expect(result.current.pendingEdits).toHaveLength(1);
    const entry = result.current.pendingEdits[0];
    expect(entry.kind).toBe('class');
    if (entry.kind === 'class') {
      expect(entry.fromClass).toBe('p-3');
      expect(entry.toClass).toContain('pt-6');
    }
  });

  it('keeps the queue across an edit-mode toggle off (stages the dirty current edit)', async () => {
    const { result, iframeRef } = setup();
    act(() => result.current.toggleEditMode());
    await select('p-3', iframeRef.current!.contentWindow!);

    act(() => result.current.setBoxSide('padding', 'top', { kind: 'scale', n: 5 }));
    act(() => result.current.toggleEditMode()); // turn off

    // The dirty edit is staged and the queue survives the toggle.
    expect(result.current.editMode).toBe(false);
    expect(result.current.pendingEdits).toHaveLength(1);
    expect(applyClassnameEdit).not.toHaveBeenCalled();
  });

  it('discardEdit removes the entry and reverts its frozen preview', async () => {
    const { result, iframeRef, postMessage } = setup();
    act(() => result.current.toggleEditMode());
    await select('p-3', iframeRef.current!.contentWindow!, { mark: '7' });

    act(() => result.current.setBoxSide('padding', 'top', { kind: 'scale', n: 4 }));
    act(() => result.current.stageCurrentEdit());
    const id = result.current.pendingEdits[0].id;

    act(() => result.current.discardEdit(id));

    expect(result.current.pendingEdits).toHaveLength(0);
    const revert = postMessage.mock.calls
      .map((c) => c[0] as { type?: string; mark?: string })
      .find((m) => m.type === 'ss:revertMark');
    expect(revert).toBeDefined();
    expect(revert!.mark).toBe('7'); // round-trips the in-iframe marker
    expect(applyClassnameEdit).not.toHaveBeenCalled();
  });

  it('discardAllEdits clears the queue and reverts every frozen preview', async () => {
    const { result, iframeRef, postMessage } = setup();
    const win = iframeRef.current!.contentWindow!;
    act(() => result.current.toggleEditMode());

    await select('p-3', win, { mark: '1' });
    act(() => result.current.setBoxSide('padding', 'top', { kind: 'scale', n: 4 }));
    await select('m-2', win, { mark: '2' }); // auto-stages the first
    act(() => result.current.setBoxSide('margin', 'top', { kind: 'scale', n: 4 }));
    act(() => result.current.stageCurrentEdit()); // stage the second

    expect(result.current.pendingEdits).toHaveLength(2);
    act(() => result.current.discardAllEdits());

    expect(result.current.pendingEdits).toHaveLength(0);
    const reverts = postMessage.mock.calls
      .map((c) => c[0] as { type?: string; mark?: string })
      .filter((m) => m.type === 'ss:revertMark')
      .map((m) => m.mark);
    expect(reverts).toEqual(expect.arrayContaining(['1', '2']));
  });

  it('carries the redline locator from the ss:select payload onto the selection', async () => {
    const { result, iframeRef } = setup();
    const win = iframeRef.current!.contentWindow!;
    act(() => result.current.toggleEditMode());

    const locator = {
      tag: 'button',
      id: 'cta',
      classList: ['p-3'],
      role: 'button',
      ariaLabel: 'Sign up',
      textSnippet: 'Sign up',
      dataAttributes: {},
      ancestorClasses: [],
      nearbyLandmark: 'nav',
    };
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: win,
          data: {
            type: 'ss:select',
            signature: { className: 'p-3', tagName: 'button', ancestorClasses: [] },
            count: 1,
            mark: '1',
            locator,
          },
        })
      );
      await Promise.resolve();
    });
    await flush();

    expect(result.current.selection?.locator).toEqual(locator);
    expect(result.current.selection?.mark).toBe('1');
  });

  it('applyAllEdits is a no-op with an empty queue', async () => {
    const { result } = setup();
    await act(async () => {
      const res = await result.current.applyAllEdits();
      expect(res).toEqual({ ok: 0, failed: 0 });
    });
    expect(applyClassnameEdit).not.toHaveBeenCalled();
  });
});
