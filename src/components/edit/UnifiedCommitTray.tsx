/**
 * Unified commit tray — the footer of the selection-driven edit panel. It lists
 * the pending DIRECT edits (class / text / image, frozen in the live preview but
 * not yet on disk) and writes them all to source with one "Apply edits to
 * source" action. Change REQUESTS are handled separately by the requests manager
 * in the panel body, not here.
 *
 * Pure presentation: it renders the edit queue it's handed and reports intent
 * (discard a row, apply the edits) back through callbacks.
 */

import { Button } from '../primitives/Button';
import type { PendingEdit } from '../../hooks/useVisualEditor';

interface Props {
  /** Direct edits frozen in the preview, awaiting the batched write. */
  pendingEdits: PendingEdit[];
  /** Write the pending edits to source. */
  onApplyEdits: () => void;
  /** Drop one staged direct edit (un-freezes its preview in the host). */
  onDiscardEdit: (id: string) => void;
  /** True while the apply write is in flight — disables the action. */
  applying?: boolean;
}

/** A short, human-readable summary of a pending direct edit: the old→new value
 *  plus the source `file:line` it'll write to. */
function editSummary(edit: PendingEdit): { tag: string; change: string; source: string | null } {
  const tag = edit.signature.tagName || 'element';
  if (edit.kind === 'class') {
    const r = edit.resolution;
    const source = r.status === 'resolved' ? `${baseName(r.file)}:${r.line}` : null;
    return { tag, change: `${edit.fromClass || '∅'} → ${edit.toClass || '∅'}`, source };
  }
  if (edit.kind === 'text') {
    return {
      tag,
      change: `“${truncate(edit.fromText)}” → “${truncate(edit.toText)}”`,
      source: `${baseName(edit.file)}:${edit.line}`,
    };
  }
  return {
    tag,
    change: `${truncate(edit.fromSrc)} → ${truncate(edit.toSrc)}`,
    source: `${baseName(edit.file)}:${edit.line}`,
  };
}

/** Last path segment — the row is tight, so the bare filename reads best. */
function baseName(file: string): string {
  const parts = file.split('/');
  return parts[parts.length - 1] || file;
}

/** Clamp a value for the one-line summary so a long class/text/src can't blow
 *  out the row. */
function truncate(value: string, max = 22): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

/** One pending direct edit row: discard control + tag + old→new + source. */
function EditRow({ edit, onDiscard }: { edit: PendingEdit; onDiscard: (id: string) => void }) {
  const { tag, change, source } = editSummary(edit);
  return (
    <li className="ss-redline-panel__row ss-commit-tray__edit-row">
      <span className="ss-commit-tray__edit-tag">{tag}</span>
      <div className="ss-redline-panel__main ss-commit-tray__edit-main">
        <span className="ss-commit-tray__edit-change" title={change}>
          {change}
        </span>
        {source && <code className="ss-redline-panel__source">{source}</code>}
      </div>
      <div className="ss-redline-panel__actions ss-commit-tray__row-actions">
        <button
          type="button"
          className="ss-redline-panel__action ss-redline-panel__action--delete"
          title="Discard this edit"
          aria-label="Discard edit"
          onClick={() => onDiscard(edit.id)}
        >
          <DiscardIcon />
        </button>
      </div>
    </li>
  );
}

function DiscardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M18 6 6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UnifiedCommitTray({
  pendingEdits,
  onApplyEdits,
  onDiscardEdit,
  applying = false,
}: Props) {
  if (pendingEdits.length === 0) return null;

  return (
    <div className="ss-commit-tray">
      <ul className="ss-redline-panel__list ss-commit-tray__list">
        {pendingEdits.map((edit) => (
          <EditRow key={edit.id} edit={edit} onDiscard={onDiscardEdit} />
        ))}
      </ul>
      <Button variant="primary" block disabled={applying} onClick={onApplyEdits}>
        {applying ? 'Applying…' : `Apply edits to source (${pendingEdits.length})`}
      </Button>
    </div>
  );
}
