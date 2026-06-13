/**
 * "Text" section of the visual editor panel, shown when the selection is a
 * resolvable text leaf. It's the panel-side counterpart to the inline
 * (double-click) editor: a textarea seeded with the element's current copy and
 * an "Apply to source" button that writes via the same `applyTextEdit` path
 * (drift-guarded), so both routes end at the same surgical write-back.
 *
 * Errors surface through the hook's toast (inside `onApply`); on a successful
 * write the hook advances the source baseline, so the seeded value re-syncs to
 * the saved text on the next render and the field returns to a clean state.
 */

import { useEffect, useId, useState, type CSSProperties } from 'react';
import { Button } from '../primitives/Button';
import { PropSection } from './PropSection';
import type { TextResolution } from '../../lib/edit';

/** The editable branch of the resolution — the panel only mounts this section
 *  when the text resolved, so `text`/`file`/… are always present here. */
type ResolvedText = Extract<TextResolution, { status: 'resolved' }>;

interface Props {
  /** The resolved text target for the current selection (the panel gates on
   *  `status === 'resolved'` before rendering, so this is always editable). */
  resolution: ResolvedText;
  /** Write the new text to source via the shared apply path. Resolves true when a
   *  write happened, false when unchanged or it failed (toast already shown). */
  onApply: (text: string) => Promise<boolean>;
}

const TEXTAREA_BASE: CSSProperties = {
  width: '100%',
  minHeight: '54px',
  maxHeight: '160px',
  resize: 'vertical',
  padding: 'var(--spacing-sm)',
  fontFamily: 'inherit',
  fontSize: 'var(--font-size-base)',
  lineHeight: 1.5,
  color: 'var(--text-primary)',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
};

export function TextEditSection({ resolution, onApply }: Props) {
  const sourceText = resolution.text;
  const fieldId = useId();
  const [value, setValue] = useState(sourceText);
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed when the source baseline changes — a fresh selection, or our own write
  // advancing it. Skipped while the user is mid-edit so typing isn't clobbered.
  useEffect(() => {
    if (!focused) setValue(sourceText);
  }, [sourceText, focused]);

  const trimmed = value.trim();
  const dirty = trimmed !== sourceText.trim();
  const canApply = dirty && trimmed.length > 0 && !saving;

  const apply = async () => {
    if (!canApply) return;
    setSaving(true);
    try {
      await onApply(trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PropSection title="Text" defaultOpen>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
        <label className="ss-edit-panel__label" htmlFor={fieldId}>
          Edit the copy and apply it to your source.
        </label>
        <textarea
          id={fieldId}
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter applies without leaving the field (Enter alone is a newline).
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void apply();
            }
          }}
          style={focused ? { ...TEXTAREA_BASE, borderColor: 'var(--action)' } : TEXTAREA_BASE}
        />
        <Button size="sm" variant="primary" block disabled={!canApply} onClick={() => void apply()}>
          {saving ? 'Applying…' : 'Apply to source'}
        </Button>
      </div>
    </PropSection>
  );
}
