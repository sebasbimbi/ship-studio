/**
 * Sizing control (width / height / max-width / min-height). A single free-form
 * field that accepts a Tailwind keyword (`full`, `screen`, `auto`), a fraction
 * (`1/2`), a scale step (`64`), or any CSS length (`480px`, `clamp(…)` → `w-[…]`),
 * with a datalist of common presets for discoverability. Always prefers the named
 * token, falling back to an arbitrary value only when off-scale.
 */

import { useId, useState } from 'react';
import { ResettableLabel } from './ResettableLabel';
import {
  lengthValue,
  parseLengthInput,
  lengthResetSpec,
  readLayer,
  LENGTH_PRESETS,
  type LayerContext,
  type ResetSpec,
} from '../../lib/edit';

interface Props {
  label: string;
  prefix: string;
  css: string;
  currentClass: string;
  layer: LayerContext;
  onApplyEnum: (token: string, style: Record<string, string>) => void;
  onReset: (spec: ResetSpec) => void;
}

export function LengthControl({
  label,
  prefix,
  css,
  currentClass,
  layer,
  onApplyEnum,
  onReset,
}: Props) {
  const { value, definedAt } = readLayer(currentClass, layer, (s) => lengthValue(s, prefix));
  const display = value ?? '';
  const listId = useId();

  const [text, setText] = useState(display);
  const [lastDisplay, setLastDisplay] = useState(display);
  const [invalid, setInvalid] = useState(false);
  // Sync the field when the value changes externally (reselect, breakpoint switch).
  if (display !== lastDisplay && !invalid) {
    setLastDisplay(display);
    setText(display);
  }

  const commit = () => {
    if (text.trim() === '') return true; // empty = leave unset (no-op)
    const parsed = parseLengthInput(text, prefix, css);
    if (parsed.kind === 'invalid') {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    onApplyEnum(parsed.token, { [css]: parsed.css });
    return true;
  };

  return (
    <div className="ss-edit-panel__control">
      <ResettableLabel
        label={label}
        definedAt={definedAt}
        active={layer.bp}
        onReset={() => onReset(lengthResetSpec(prefix, css))}
      />
      <input
        className={`ss-edit-panel__text${invalid ? ' ss-edit-panel__num--invalid' : ''}`}
        inputMode="text"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        list={listId}
        aria-label={label}
        aria-invalid={invalid}
        placeholder="auto"
        title={
          invalid ? 'Use a keyword (full, auto), fraction (1/2), or length (480px, 50%)' : label
        }
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (invalid) setInvalid(false);
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => {
          if (!commit()) {
            setText(display);
            setInvalid(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && commit()) e.currentTarget.blur();
        }}
      />
      <datalist id={listId}>
        {LENGTH_PRESETS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </div>
  );
}
